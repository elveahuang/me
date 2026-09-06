import { db } from '@/db';
import { ensureBuiltinModelAvailable, resolveModel, resolveProviderModel } from '@/lib/ai';
import { errorResponse, HttpError, readJson, requireUser } from '@/lib/api';
import { consumeChatQuota } from '@/lib/billing';
import { corsMiddleware, corsResponseHeaders } from '@/lib/cors';
import { buildMcpToolSets } from '@/lib/mcp';
import { buildSystemPrompt } from '@/lib/prompt';
import { retrieveKnowledge } from '@/lib/rag';
import { rateLimit } from '@/lib/rate-limit';
import { buildToolSet } from '@/lib/tools';
import {
    agentMcpServers,
    agents,
    agentSkills,
    agentTools,
    aiProviders,
    conversations,
    mcpServers,
    messages as messagesTable,
    skills,
    tools as toolsTable,
} from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import type { UIMessage, UIMessageChunk } from 'ai';
import { convertToModelMessages, JsonToSseTransformStream, stepCountIs, streamText } from 'ai';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

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
                case 'reasoning-start': {
                    const part = { type: 'reasoning', text: '', state: 'streaming' } as unknown as UIMessage['parts'][number];
                    partById.set((chunk as { id: string }).id, part);
                    parts.push(part);
                    break;
                }
                case 'reasoning-delta': {
                    const part = partById.get((chunk as { id: string }).id);
                    if (part && (part as { type: string }).type === 'reasoning') {
                        (part as { text: string }).text += (chunk as { delta: string }).delta;
                    }
                    break;
                }
                case 'reasoning-end': {
                    const part = partById.get((chunk as { id: string }).id);
                    if (part && (part as { type: string }).type === 'reasoning') {
                        (part as { state?: string }).state = 'done';
                    }
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
        .max(80)
        // 请求体体积上限（512KB），防止超大 parts 滥用
        .refine((v) => JSON.stringify(v).length <= 512 * 1024, { message: '消息体积过大' }),
});

export const Route = createFileRoute('/api/chat')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            POST: async ({ request }) => {
                // MCP 连接建立后到流接管清理（collectAssistantMessage 的 finally）之间如有异常，
                // 必须在外层 catch 释放连接（stdio 模式是子进程，泄漏会累积；dispose 可安全重复调用）
                let disposeMcpRef: (() => Promise<void>) | null = null;
                try {
                    const session = await requireUser(request);

                    // 限流：每个用户每分钟最多 30 次对话请求
                    const limited = await rateLimit(`chat:${session.user.id}`, 30, 60_000);
                    if (!limited.ok) {
                        return Response.json(
                            { error: `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试` },
                            { status: 429, headers: { 'retry-after': String(limited.retryAfterSec), ...corsResponseHeaders() } },
                        );
                    }

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

                    // 会员配额：请求校验通过、确定要发起生成时才原子消耗一次当日额度
                    // （放在 MCP 建连之前：402 路径不创建任何需要清理的资源）
                    await consumeChatQuota(session.user.id);

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
                    const { toolSet: mcpToolSet, summary: mcpSummary, dispose: disposeMcp } = await buildMcpToolSets(mcpServerRows.map((row) => row.server));
                    disposeMcpRef = disposeMcp;

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

                    // 5. 从数据库取权威历史：只取最近 N 条（seq 倒序取后反转），避免长会话全量加载
                    const windowed = (
                        await db
                            .select({ role: messagesTable.role, parts: messagesTable.parts })
                            .from(messagesTable)
                            .where(eq(messagesTable.conversationId, conv.id))
                            .orderBy(desc(messagesTable.seq))
                            .limit(MAX_CONTEXT_MESSAGES)
                    ).reverse();

                    // 确保滑动窗口的开头是一条完整的用户消息，避免被截断的中间工具响应或孤立助手消息破坏上下文
                    let startIndex = 0;
                    while (startIndex < windowed.length && windowed[startIndex]?.role !== 'user') {
                        startIndex++;
                    }
                    const trimmedWindow = startIndex < windowed.length ? windowed.slice(startIndex) : windowed;

                    // 对早期历史消息中的工具输出进行按需压缩，保护长对话的 Token 预算
                    const MAX_HISTORICAL_TOOL_OUTPUT = 800;
                    const historyLength = trimmedWindow.length;
                    const optimizedWindow = trimmedWindow.map((m, idx) => {
                        // 保留最近 2 条消息的原貌，较早的历史进行输出折叠
                        if (idx >= historyLength - 2) {
                            return m;
                        }
                        const parts = (m.parts as UIMessage['parts']).map((part) => {
                            if (part && typeof part === 'object' && 'type' in part && typeof part.type === 'string' && part.type.startsWith('tool-')) {
                                const toolPart = part as { output?: unknown };
                                if (typeof toolPart.output === 'string' && toolPart.output.length > MAX_HISTORICAL_TOOL_OUTPUT) {
                                    return {
                                        ...part,
                                        output: toolPart.output.slice(0, MAX_HISTORICAL_TOOL_OUTPUT) + '\n...[早期工具调用结果已压缩]',
                                    };
                                }
                            }
                            return part;
                        });
                        return { ...m, parts };
                    });

                    const uiMessages = optimizedWindow.map((m) => ({
                        id: '',
                        role: m.role as UIMessage['role'],
                        parts: m.parts as UIMessage['parts'],
                    }));
                    const modelMessages = await convertToModelMessages(uiMessages);

                    // 6. RAG 检索：提取当前用户问题，结合上下文代词消解增强检索准确度
                    const lastUserMsg = [...incoming].reverse().find((m) => m.role === 'user');
                    const currentQuery =
                        lastUserMsg?.parts.find((p): p is { type: 'text'; text: string } => (p as { type?: string }).type === 'text')?.text?.trim() ?? '';

                    let searchKeyword = currentQuery;
                    if (currentQuery) {
                        // 检测是否为超短提问或包含指代代词（如"它怎么配置"、"这个呢"、"为什么"）
                        const isShortOrAnaphoric = currentQuery.length < 15 || /(它|他|她|这|那|其|上面|前面|上述|这个|那个)/.test(currentQuery);

                        if (isShortOrAnaphoric && trimmedWindow.length > 1) {
                            // 查找上一轮用户的提问作为上下文补充
                            const previousUserMsg = [...trimmedWindow]
                                .slice(0, -1)
                                .reverse()
                                .find((m) => m.role === 'user');
                            const prevText = (previousUserMsg?.parts as UIMessage['parts'] | undefined)
                                ?.find((p): p is { type: 'text'; text: string } => (p as { type?: string }).type === 'text')
                                ?.text?.trim();

                            if (prevText) {
                                searchKeyword = `${prevText} ${currentQuery}`;
                            }
                        }
                    }

                    let knowledgeContext: string | null = null;
                    if (searchKeyword.trim()) {
                        try {
                            knowledgeContext = await retrieveKnowledge(agent.id, searchKeyword.trim());
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
                        { name: session.user.name, role: session.user.role },
                    );

                    const toolSet = buildToolSet(toolRows.map((row) => row.tool));
                    Object.assign(toolSet, mcpToolSet);

                    // 7. 流式生成（应用温度、最大 Token 与最大步数）
                    const result = streamText({
                        model,
                        system,
                        messages: modelMessages,
                        tools: toolSet,
                        temperature: agent.temperature ?? undefined,
                        maxOutputTokens: agent.maxTokens ?? undefined,
                        stopWhen: stepCountIs(agent.maxSteps ?? 6),
                        abortSignal: request.signal,
                    });

                    // 8. 服务端自行消费 UI 流：开启思考过程流式传递，一路转 SSE 给客户端，一路收集助手消息落库
                    const uiStream = result.toUIMessageStream({ sendReasoning: true });
                    const [clientBranch, collectBranch] = uiStream.tee();
                    void collectAssistantMessage(collectBranch, conv.id).finally(() => {
                        void disposeMcp();
                    });

                    const sse = clientBranch.pipeThrough(new JsonToSseTransformStream()).pipeThrough(new TextEncoderStream());
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
                    if (disposeMcpRef) await disposeMcpRef();
                    return errorResponse(e);
                }
            },
        },
    },
});
