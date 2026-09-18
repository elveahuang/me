import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText, type UIMessage } from 'ai';
import { and, desc, eq } from 'drizzle-orm';
import {
    agentKnowledgeBases,
    agentMcpServers,
    agentSkills,
    agentTools,
    agents,
    conversations,
    messages as messagesTable,
    skills,
    tools as toolsTable,
} from '../db/schema';
import { consumeChatQuota } from '../utils/billing';
import { retrieveContext } from '../utils/embedding';
import { requireUser } from '../utils/guard';
import { closeMcpConnections, connectEnabledMcpServers, mergeMcpTools } from '../utils/mcp';
import { resolveModel } from '../utils/providers';
import { rateLimit } from '../utils/rate-limit';
import { buildSelfConfigTool } from '../utils/self-config';
import { buildSystemPrompt } from '../utils/system-prompt';
import { buildToolSet } from '../utils/tools';

/** 发送给模型的上下文窗口（最近 N 条消息），控制长会话的 token 成本 */
const MAX_CONTEXT_MESSAGES = 24;

/** 用户消息里允许落库的 part 类型（assistant 专属的 reasoning / tool-* 不允许由客户端写入） */
const USER_PART_TYPES = new Set(['text', 'file', 'image', 'data']);

/**
 * 只保留结构合法的用户 part。
 *
 * 除了类型白名单，还要校验各类型的必需字段：
 * file/image 的 url 必须是绝对地址——AI SDK 在构造模型消息时会对 url 调用 `new URL()`，
 * 相对路径会抛 TypeError。该 part 一旦落库就会成为历史的一部分，
 * 此后该会话每次请求都会 500（等于被永久毒化），因此必须在入口拦掉。
 */
function sanitizeUserParts(parts: unknown): unknown[] {
    if (!Array.isArray(parts)) return [];
    return parts.filter((part) => {
        if (!part || typeof part !== 'object') return false;
        const candidate = part as { type?: unknown; text?: unknown; url?: unknown };
        if (typeof candidate.type !== 'string' || !USER_PART_TYPES.has(candidate.type)) return false;

        if (candidate.type === 'text') {
            return typeof candidate.text === 'string';
        }
        if (candidate.type === 'file' || candidate.type === 'image') {
            if (typeof candidate.url !== 'string' || !candidate.url) return false;
            try {
                const parsed = new URL(candidate.url);
                return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:';
            } catch {
                return false;
            }
        }
        // data part：任意 JSON 结构，保留
        return true;
    });
}

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);

    // 1. 分布式限流：每用户每分钟最多 30 次请求
    const limited = await rateLimit(`chat:${session.user.id}`, 30, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }

    const body = await readBody<{ messages: UIMessage[]; conversationId?: string; agentId?: string }>(event);
    const { messages: incoming, conversationId, agentId } = body ?? {};

    if (!agentId || !incoming?.length) {
        throw createError({ statusCode: 400, statusMessage: 'agentId and messages are required' });
    }

    // 防滥用：检查请求体体积（上限 512KB）
    if (JSON.stringify(incoming).length > 512 * 1024) {
        throw createError({ statusCode: 400, statusMessage: '消息体积过大（上限 512KB）' });
    }

    // 2. 智能体必须存在且启用
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent || !agent.enabled) {
        throw createError({ statusCode: 404, statusMessage: '智能体不存在或未启用' });
    }

    // 3. 校验并原子消耗一次当日对话配额（超限直接抛出 402）
    await consumeChatQuota(session.user.id);

    // 4. 加载智能体绑定的 Skills / Tools / 知识库 / MCP 服务器
    const boundSkills = await db
        .select({
            id: skills.id,
            name: skills.name,
            description: skills.description,
            instructions: skills.instructions,
            enabled: skills.enabled,
        })
        .from(agentSkills)
        .innerJoin(skills, eq(skills.id, agentSkills.skillId))
        .where(and(eq(agentSkills.agentId, agentId), eq(skills.enabled, true)));

    const boundTools = await db
        .select({ tool: toolsTable })
        .from(agentTools)
        .innerJoin(toolsTable, eq(toolsTable.id, agentTools.toolId))
        .where(and(eq(agentTools.agentId, agentId), eq(toolsTable.enabled, true)));

    const boundKbIds = (await db.select({ kbId: agentKnowledgeBases.kbId }).from(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, agentId))).map(
        (r) => r.kbId,
    );
    const boundMcpIds = (await db.select({ mcpServerId: agentMcpServers.mcpServerId }).from(agentMcpServers).where(eq(agentMcpServers.agentId, agentId))).map(
        (r) => r.mcpServerId,
    );

    // 5. 会话处理
    let row = conversationId ? (await db.select().from(conversations).where(eq(conversations.id, conversationId)))[0] : undefined;

    const lastUserMessage = [...incoming].reverse().find((m) => m.role === 'user');
    const lastUserText =
        lastUserMessage?.parts
            .filter((p): p is { type: 'text'; text: string } => (p as { type?: string }).type === 'text')
            .map((p) => p.text)
            .join('') ?? '';

    if (!row) {
        const newId = crypto.randomUUID();
        await db.insert(conversations).values({
            id: newId,
            userId: session.user.id,
            agentId,
            title: lastUserText.slice(0, 30) || '新对话',
        });
        row = (await db.select().from(conversations).where(eq(conversations.id, newId)))[0];
    } else if (row.userId !== session.user.id) {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    } else if ((row.title === '新对话' || !row.title) && lastUserText.trim()) {
        const autoTitle = lastUserText.trim().slice(0, 30);
        await db.update(conversations).set({ title: autoTitle, updatedAt: new Date() }).where(eq(conversations.id, row.id));
        row.title = autoTitle;
    }
    const conversation = row!;

    // 6. 落库客户端消息（按消息 id 幂等）
    //    只接受 user 角色：服务端历史是上下文唯一事实来源，
    //    否则客户端可以伪造 assistant 回复与 tool 结果污染后续所有轮次。
    if (incoming.length > 0) {
        for (const m of incoming) {
            if (m.role !== 'user') continue;
            const parts = sanitizeUserParts(m.parts);
            if (!parts.length) continue;
            // id 是主键且必填：客户端未带 id 时服务端补一个，
            // 否则 insert 会因 undefined 参数报 500 —— 而额度在此之前已经扣掉了。
            const messageId = typeof m.id === 'string' && m.id.trim() ? m.id : `cmsg_${crypto.randomUUID()}`;
            await db
                .insert(messagesTable)
                .values({
                    id: messageId,
                    conversationId: conversation.id,
                    role: 'user',
                    parts,
                })
                .onConflictDoNothing();
        }
    }
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversation.id));

    // 7. 从数据库取权威历史（最近 MAX_CONTEXT_MESSAGES 条，按 seq 稳定排序），
    //    既控制长会话 Token 成本，也避免客户端传入的历史污染上下文
    const windowed = (
        await db
            .select({ role: messagesTable.role, parts: messagesTable.parts })
            .from(messagesTable)
            .where(eq(messagesTable.conversationId, conversation.id))
            .orderBy(desc(messagesTable.seq))
            .limit(MAX_CONTEXT_MESSAGES)
    ).reverse();

    // 滑动窗口开头必须是完整的用户消息，避免截断出的孤立工具响应破坏上下文
    let startIndex = 0;
    while (startIndex < windowed.length && windowed[startIndex]?.role !== 'user') {
        startIndex++;
    }
    const trimmedWindow = startIndex < windowed.length ? windowed.slice(startIndex) : windowed;

    const MAX_HISTORICAL_TOOL_OUTPUT = 800;
    const historyLength = trimmedWindow.length;
    const optimizedWindow = trimmedWindow.map((m, idx) => {
        // 最近 2 条保留原貌，更早的历史折叠过长的工具输出
        if (idx >= historyLength - 2) return m;
        const parts = (m.parts as unknown[] | undefined)?.map((part) => {
            if (part && typeof part === 'object' && 'type' in part && typeof part.type === 'string' && part.type.startsWith('tool-')) {
                const toolPart = part as { output?: unknown };
                if (typeof toolPart.output === 'string' && toolPart.output.length > MAX_HISTORICAL_TOOL_OUTPUT) {
                    return {
                        ...part,
                        output: toolPart.output.slice(0, MAX_HISTORICAL_TOOL_OUTPUT) + '\n...[早期工具结果已压缩]',
                    };
                }
            }
            return part;
        });
        return { ...m, parts };
    });

    // 8. RAG 知识库检索（结合上下文增强检索）
    let knowledgeContext: string | null = null;
    if (boundKbIds.length && lastUserText.trim()) {
        try {
            let searchKeyword = lastUserText.trim();
            const isShortOrAnaphoric = searchKeyword.length < 15 || /(它|他|她|这|那|其|上面|前面|上述|这个|那个)/.test(searchKeyword);
            if (isShortOrAnaphoric && trimmedWindow.length > 1) {
                const prevUserMsg = [...trimmedWindow]
                    .slice(0, -1)
                    .reverse()
                    .find((m) => m.role === 'user');
                const prevText = prevUserMsg?.parts
                    .filter((p): p is { type: 'text'; text: string } => (p as { type?: string }).type === 'text')
                    .map((p) => p.text)
                    .join('')
                    .trim();
                if (prevText) {
                    searchKeyword = `${prevText} ${searchKeyword}`;
                }
            }

            const { context, hits } = await retrieveContext(boundKbIds, searchKeyword);
            if (context && hits.length > 0) {
                knowledgeContext = context;
            }
        } catch (error) {
            console.error('[chat] RAG 检索异常:', error);
        }
    }

    // 9. 供应商与模型解析
    const { model } = await resolveModel(agent.providerId, agent.model);

    // 10. 工具集与 MCP 连接
    let toolSet = buildToolSet(boundTools.map((row) => row.tool));
    if (agent.selfConfig) {
        toolSet['self-config'] = buildSelfConfigTool(agentId);
    }
    const mcpConnections = await connectEnabledMcpServers(boundMcpIds);
    if (mcpConnections.length) {
        toolSet = mergeMcpTools(toolSet, mcpConnections);
    }

    // 11. 组装系统提示词
    const toolSummary = [
        ...boundTools.map((row) => `- ${row.tool.name}（${row.tool.type === 'http' ? 'HTTP 工具' : '内置工具'}）：${row.tool.description}`),
        ...mcpConnections.map((c) => `- [MCP] ${c.serverName}`),
    ].join('\n');

    const system = buildSystemPrompt(agent, boundSkills as any, knowledgeContext, toolSummary.trim() ? toolSummary : null, {
        name: session.user.name,
        role: session.user.role,
    });

    // 12. 流式生成（带温度、Token 限制与思维链传递）
    const modelMessages = await convertToModelMessages(
        optimizedWindow.map((m) => ({ id: '', role: m.role as UIMessage['role'], parts: m.parts as UIMessage['parts'] })),
    );
    const maxSteps = agent.maxSteps ?? 6;

    const result = streamText({
        model,
        system: system || undefined,
        messages: modelMessages,
        tools: toolSet,
        temperature: agent.temperature ?? undefined,
        maxOutputTokens: agent.maxTokens ?? undefined,
        stopWhen: stepCountIs(maxSteps),
    });

    const responseStream = createUIMessageStream({
        execute: ({ writer }) => {
            writer.merge(result.toUIMessageStream({ sendStart: false, sendReasoning: true }));
        },
        onError: (error) => {
            closeMcpConnections(mcpConnections);
            return String(error);
        },
        onFinish: async ({ messages: responseMessages, isAborted }) => {
            try {
                const assistantMessage = [...responseMessages].reverse().find((m) => m.role === 'assistant' && m.parts?.length);
                if (assistantMessage) {
                    await db
                        .insert(messagesTable)
                        .values({
                            id: assistantMessage.id || crypto.randomUUID(),
                            conversationId: conversation.id,
                            role: 'assistant',
                            parts: assistantMessage.parts,
                        })
                        .onConflictDoNothing();
                    if (isAborted) {
                        console.info(`[chat] 用户中断生成，已保存已产出的部分回复（conversation=${conversation.id}）`);
                    }
                }
            } finally {
                await closeMcpConnections(mcpConnections);
            }
        },
    });

    return createUIMessageStreamResponse({
        stream: responseStream,
        headers: { 'x-conversation-id': conversation.id },
    });
});
