import { createFileRoute } from '@tanstack/react-router';
import type { UIMessage, UIMessageChunk } from 'ai';
import { convertToModelMessages, JsonToSseTransformStream, stepCountIs, streamText } from 'ai';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
    agentMcpServers,
    agentSkills,
    agentTools,
    agents,
    aiProviders,
    conversations,
    mcpServers,
    messages as messagesTable,
    skills,
    tools as toolsTable,
} from '@schema';
import { ensureBuiltinModelAvailable, resolveModel, resolveProviderModel } from '@/lib/ai';
import { errorResponse, HttpError, readJson, requireUser } from '@/lib/api';
import { corsMiddleware, corsResponseHeaders } from '@/lib/cors';
import { buildMcpToolSets } from '@/lib/mcp';
import { buildSystemPrompt } from '@/lib/prompt';
import { retrieveKnowledge } from '@/lib/rag';
import { buildToolSet } from '@/lib/tools';

/** 发送给模型的上下文窗口（最近 N 条消息），控制长会话的 token 成本 */
const MAX_CONTEXT_MESSAGES = 24;

/**
 * 从 UI message chunk 流中重组助手消息（text / tool parts）。
 * 兼容流中断：把已收到的内容尽量落库。
 */
async function collectAssistantMessage(chunkStream: AsyncIterable<UIMessageChunk>, conversationId: number) {
    let assistantId: string = crypto.randomUUID();
    const parts: UIMessage['parts'] = [];
    const partById = new Map<string, UIMessage['parts'][number]>();

    try {
        for await (const chunk of chunkStream) {
            switch (chunk.type) {
                case 'start': {
                    if (chunk.messageId) assistantId = chunk.messageId;
                    break;
                }
                case 'text-start': {
                    const part = { type: 'text', text: '', state: 'streaming' } as UIMessage['parts'][number];
                    partById.set(chunk.id, part);
                    parts.push(part);
                    break;
                }
                case 'text-delta': {
                    const part = partById.get(chunk.id);
                    if (part && part.type === 'text') part.text += chunk.delta;
                    break;
                }
                case 'text-end': {
                    const part = partById.get(chunk.id);
                    if (part && part.type === 'text') part.state = 'done';
                    break;
                }
                case 'tool-input-available': {
                    const part = {
                        type: `tool-${chunk.toolName}`,
                        toolCallId: chunk.toolCallId,
                        input: chunk.input,
                        state: 'input-available',
                    } as UIMessage['parts'][number];
                    partById.set(chunk.toolCallId, part);
                    parts.push(part);
                    break;
                }
                case 'tool-output-available': {
                    const part = partById.get(chunk.toolCallId);
                    if (part && part.type.startsWith('tool-')) {
                        (part as { output?: unknown }).output = chunk.output;
                        (part as { state?: string }).state = 'output-available';
                    }
                    break;
                }
                default:
                    break;
            }
        }
    } catch (e) {
        console.error('[chat] 收集助手流中断（保留已收到的内容）:', e);
    }

    if (parts.length === 0) return;

    try {
        await db
            .insert(messagesTable)
            .values({ id: assistantId, conversationId, role: 'assistant', parts })
            .onConflictDoUpdate({ target: messagesTable.id, set: { parts } });
        await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
    } catch (e) {
        console.error('[chat] 助手消息落库失败:', e);
    }
}

const ChatBodySchema = z.object({
    agentId: z.number().int().positive(),
    conversationId: z.number().int().positive().optional(),
    messages: z
        .array(
            z.object({
                id: z.string().min(1),
                role: z.string(),
                parts: z.array(z.unknown()),
            }),
        )
        .min(1)
        .max(80),
});

export const Route = createFileRoute('/api/chat')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            POST: async ({ request }) => {
                try {
                    const session = await requireUser(request);

                    const body = await readJson<unknown>(request);
                    const parsed = ChatBodySchema.safeParse(body);
                    if (!parsed.success) {
                        throw new HttpError(400, `请求参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    }
                    const { agentId, conversationId, messages: incoming } = parsed.data;

                    // 1. 智能体必须存在且启用，并加载挂载的 Skills / Tools / 知识库
                    const [agent] = await db
                        .select()
                        .from(agents)
                        .where(and(eq(agents.id, agentId), eq(agents.enabled, true)));
                    if (!agent) throw new HttpError(404, '智能体不存在或未启用');

                    // 2. 模型解析（内置供应商按模型校验 key；自定义供应商读库）
                    let model;
                    if (agent.providerId) {
                        const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, agent.providerId));
                        if (!provider || !provider.enabled || !provider.baseUrl) {
                            throw new HttpError(503, '该智能体绑定的 AI 供应商不可用，请联系管理员');
                        }
                        model = resolveProviderModel(provider, agent.model);
                    } else {
                        ensureBuiltinModelAvailable(agent.model);
                        model = resolveModel(agent.model);
                    }

                    const skillRows = await db
                        .select({ skill: skills })
                        .from(agentSkills)
                        .innerJoin(skills, eq(agentSkills.skillId, skills.id))
                        .where(eq(agentSkills.agentId, agent.id));

                    const toolRows = await db
                        .select({ tool: toolsTable })
                        .from(agentTools)
                        .innerJoin(toolsTable, eq(agentTools.toolId, toolsTable.id))
                        .where(eq(agentTools.agentId, agent.id));

                    // MCP 服务器：连接并列出工具，转换为 AI SDK 动态工具
                    const mcpServerRows = await db
                        .select({ server: mcpServers })
                        .from(agentMcpServers)
                        .innerJoin(mcpServers, eq(agentMcpServers.mcpServerId, mcpServers.id))
                        .where(and(eq(agentMcpServers.agentId, agent.id), eq(mcpServers.enabled, true)));
                    const { toolSet: mcpToolSet, summary: mcpSummary, dispose: disposeMcp } = await buildMcpToolSets(
                        mcpServerRows.map((row) => row.server),
                    );

                    // 3. 解析（或创建）会话，只能聊自己的会话
                    let conversation = conversationId
                        ? (
                              await db
                                  .select()
                                  .from(conversations)
                                  .where(and(eq(conversations.id, conversationId), eq(conversations.userId, session.user.id)))
                          )[0]
                        : undefined;
                    if (conversationId && !conversation) throw new HttpError(404, '会话不存在');

                    if (!conversation) {
                        const firstUserMessage = incoming.find((m) => m.role === 'user');
                        const firstText = firstUserMessage?.parts.find(
                            (p): p is { type: 'text'; text: string } => (p as { type?: string }).type === 'text',
                        )?.text;
                        const [created] = await db
                            .insert(conversations)
                            .values({
                                userId: session.user.id,
                                agentId: agent.id,
                                title: (firstText ?? '新对话').slice(0, 30) || '新对话',
                            })
                            .returning();
                        conversation = created;
                    }
                    if (!conversation) throw new HttpError(500, '会话创建失败');
                    const conv = conversation;

                    // 4. 按消息 id 幂等落库客户端发来的消息（防止重发/断线重连重复）
                    if (incoming.length > 0) {
                        await db
                            .insert(messagesTable)
                            .values(
                                incoming.map((m) => ({
                                    id: m.id,
                                    conversationId: conv.id,
                                    role: m.role,
                                    parts: m.parts,
                                })),
                            )
                            .onConflictDoNothing({ target: messagesTable.id });
                    }

                    // 5. 从数据库取权威历史，窗口截断后转成模型消息
                    const history = await db
                        .select({ role: messagesTable.role, parts: messagesTable.parts })
                        .from(messagesTable)
                        .where(eq(messagesTable.conversationId, conv.id))
                        .orderBy(asc(messagesTable.seq));

                    const windowed = history.slice(-MAX_CONTEXT_MESSAGES);
                    const uiMessages = windowed.map((m) => ({
                        id: '',
                        role: m.role as UIMessage['role'],
                        parts: m.parts as UIMessage['parts'],
                    }));
                    const modelMessages = await convertToModelMessages(uiMessages);

                    // 6. RAG 检索：以最后一条用户消息为查询，命中则注入系统提示词
                    const lastUserText = [...incoming].reverse().find((m) => m.role === 'user');
                    const queryText = lastUserText?.parts.find(
                        (p): p is { type: 'text'; text: string } => (p as { type?: string }).type === 'text',
                    )?.text;
                    let knowledgeContext: string | null = null;
                    if (queryText?.trim()) {
                        try {
                            knowledgeContext = await retrieveKnowledge(agent.id, queryText.trim());
                        } catch (e) {
                            console.error('[chat] 知识库检索失败（跳过）:', e);
                        }
                    }

                    const system = buildSystemPrompt(
                        agent,
                        skillRows.map((row) => row.skill),
                        knowledgeContext,
                        toolRows.length + Object.keys(mcpToolSet).length > 0
                            ? [
                                  ...toolRows.map(
                                      (row) => `- ${row.tool.name}（${row.tool.type === 'http' ? 'HTTP 工具' : '内置工具'}）：${row.tool.description}`,
                                  ),
                                  ...mcpSummary,
                              ].join('\n')
                            : null,
                    );

                    const toolSet = buildToolSet(toolRows.map((row) => row.tool));
                    Object.assign(toolSet, mcpToolSet);

                    // 7. 流式生成
                    const result = streamText({
                        model,
                        system,
                        messages: modelMessages,
                        tools: toolSet,
                        stopWhen: stepCountIs(6),
                        abortSignal: request.signal,
                    });

                    // 8. 服务端自行消费 UI 流：一路转 SSE 给客户端，一路收集助手消息落库
                    const uiStream = result.toUIMessageStream({ sendReasoning: false });
                    const [clientBranch, collectBranch] = uiStream.tee();
                    void collectAssistantMessage(collectBranch, conv.id).finally(() => {
                        void disposeMcp();
                    });

                    const sse = clientBranch
                        .pipeThrough(new JsonToSseTransformStream())
                        .pipeThrough(new TextEncoderStream());
                    const response = new Response(sse, {
                        status: 200,
                        headers: {
                            'content-type': 'text/event-stream; charset=utf-8',
                            'cache-control': 'no-cache',
                            'x-conversation-id': String(conv.id),
                            ...corsResponseHeaders(),
                        },
                    });
                    return response;
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
