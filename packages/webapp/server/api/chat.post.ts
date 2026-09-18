import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText, type UIMessage } from 'ai';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
    agentKnowledgeBases,
    agentMcpServers,
    agentSkills,
    agentTools,
    agents,
    attachments as attachmentsTable,
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
 * 站内附件路径白名单：私有桶的附件以 `/api/attachments/{id}/raw` 形式保存
 * （见 /api/attachments/chat-parts）。这是唯一允许的相对地址形式——
 * 其他相对路径会被 AI SDK 的 `new URL()` 抛错，一旦落库就会让整个会话永久 500。
 */
const INTERNAL_ATTACHMENT_PATH = /^\/api\/attachments\/[0-9a-f-]{36}\/raw$/i;

/** 从站内路径里取出附件 id（非站内路径返回 null） */
function internalAttachmentId(url: string): string | null {
    const match = url.match(/^\/api\/attachments\/([0-9a-f-]{36})\/raw$/i);
    return match ? match[1]! : null;
}

/**
 * 只保留结构合法的用户 part。
 *
 * file/image 的 url 允许两种形式：
 * 1. 绝对地址（http/https/data）——公开桶地址或用户自贴的外链
 * 2. 站内附件路径 `/api/attachments/{id}/raw`——私有桶附件，浏览器带 cookie 可读，
 *    模型侧由 toModelParts() 转成文字说明
 * 其他相对路径一律拒绝：AI SDK 构造模型消息时会对 url 调用 `new URL()`，
 * 抛错会让该会话此后每次请求都 500（等于被永久毒化），必须在入口拦掉。
 */
function sanitizeUserParts(parts: unknown): unknown[] {
    if (!Array.isArray(parts)) return [];
    return parts.filter((part) => {
        if (!part || typeof part !== 'object') return false;
        const candidate = part as { type?: unknown; text?: unknown; url?: unknown; mediaType?: unknown };
        if (typeof candidate.type !== 'string' || !USER_PART_TYPES.has(candidate.type)) return false;

        if (candidate.type === 'text') {
            return typeof candidate.text === 'string';
        }
        if (candidate.type === 'file' || candidate.type === 'image') {
            if (typeof candidate.url !== 'string' || !candidate.url) return false;
            // mediaType 是 AI SDK 的必需字段，缺失会让下游供应商调用失败
            if (typeof candidate.mediaType !== 'string' || !candidate.mediaType) return false;
            if (candidate.url.startsWith('/')) {
                return INTERNAL_ATTACHMENT_PATH.test(candidate.url);
            }
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

/** 收集 parts 中所有站内附件引用 id（去重前） */
function collectInternalAttachmentIds(parts: unknown[]): string[] {
    const ids: string[] = [];
    for (const p of parts) {
        const url = (p as { url?: unknown })?.url;
        if (typeof url === 'string' && url.startsWith('/')) {
            const id = internalAttachmentId(url);
            if (id) ids.push(id);
        }
    }
    return ids;
}

/**
 * 校验站内附件引用确实属于当前用户（一次查库拿回全部合法 id）。
 * 只做格式校验不够：否则用户可以伪造 `/api/attachments/{别人的id}/raw`，
 * 让 assistant 回复里出现指向他人附件的链接。返回属于该用户的 id 集合。
 */
async function ownedAttachmentIds(ids: string[], userId: string): Promise<Set<string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Set();
    const rows = await db
        .select({ id: attachmentsTable.id })
        .from(attachmentsTable)
        .where(and(inArray(attachmentsTable.id, unique), eq(attachmentsTable.userId, userId)));
    return new Set(rows.map((row) => row.id));
}

/** 丢弃引用了不存在/非本人附件的 part，其余原样保留 */
function dropUnownedAttachmentRefs(parts: unknown[], owned: Set<string>): unknown[] {
    return parts.filter((p) => {
        const url = (p as { url?: unknown })?.url;
        if (typeof url !== 'string' || !url.startsWith('/')) return true;
        const id = internalAttachmentId(url);
        return id ? owned.has(id) : false;
    });
}

/** uuid 形态校验：conversations.id 是 uuid 列，非法串会在 PostgreSQL 抛 22P02 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 把客户端传入的 messages 夹成可安全遍历的形状，只保留 role/parts 结构合法的条目。
 *
 * 必须在扣额之前调用：后续代码会对 `m.parts.filter(...)`、`m.role` 取值，
 * 数组里混进 null/字符串/无 parts 的对象会在 consumeChatQuota 之后抛 TypeError，
 * 用户白白损失一次配额却拿不到回复。畸形条目按与 sanitizeUserParts 一致的策略丢弃。
 */
function normalizeIncomingMessages(value: unknown): UIMessage[] {
    if (!Array.isArray(value)) return [];
    return value.filter((m): m is UIMessage => {
        if (!m || typeof m !== 'object') return false;
        const candidate = m as { role?: unknown; parts?: unknown };
        return typeof candidate.role === 'string' && Array.isArray(candidate.parts);
    });
}

/** 从 parts 中拼出纯文本，用于会话标题与 RAG 检索词 */
function partsToText(parts: unknown): string {
    if (!Array.isArray(parts)) return '';
    return parts
        .filter(
            (p): p is { type: 'text'; text: string } => !!p && (p as { type?: unknown }).type === 'text' && typeof (p as { text?: unknown }).text === 'string',
        )
        .map((p) => p.text)
        .join('');
}

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);

    // 1. 分布式限流：每用户每分钟最多 30 次请求
    const limited = await rateLimit(`chat:${session.user.id}`, 30, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }

    const body = await readBody<{ messages: unknown; conversationId?: unknown; agentId?: unknown }>(event);
    const incoming = normalizeIncomingMessages(body?.messages);
    const agentId = typeof body?.agentId === 'string' ? body.agentId : '';
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';

    // 必须带一条结构完整的 user 消息：只传 assistant 消息同样会走完扣额与生成，
    // 但服务端没有任何新输入可落库，等于用一次配额触发一轮无意义的模型调用。
    if (!agentId || !incoming.some((m) => m.role === 'user')) {
        throw createError({ statusCode: 400, statusMessage: 'agentId and messages are required' });
    }

    // 会话 id 直接进 uuid 列的等值查询：非法值会在**扣额之后**抛 22P02 变成 500，
    // 这里先夹住，让无效或过期的 id 得到一个明确的 400 而不是白扣配额。
    if (conversationId && !UUID_RE.test(conversationId)) {
        throw createError({ statusCode: 400, statusMessage: 'conversationId 非法' });
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
    const lastUserText = partsToText(lastUserMessage?.parts);

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
    //    先做本地清洗，再一次性查回所有站内附件的归属，最后一条事务批量写入，
    //    避免「每条消息一次归属查询 + 一次 INSERT + 一次 UPDATE」的往返放大。
    const candidateMessages = incoming
        .filter((m) => m.role === 'user')
        .map((m) => ({
            // id 是主键且必填：客户端未带 id 时服务端补一个，
            // 否则 insert 会因 undefined 参数报 500 —— 而额度在此之前已经扣掉了。
            id: typeof m.id === 'string' && m.id.trim() ? m.id : `cmsg_${crypto.randomUUID()}`,
            parts: sanitizeUserParts(m.parts),
        }))
        .filter((m) => m.parts.length);

    const owned = await ownedAttachmentIds(
        candidateMessages.flatMap((m) => collectInternalAttachmentIds(m.parts)),
        session.user.id,
    );
    const rowsToInsert = candidateMessages
        .map((m) => ({ id: m.id, parts: dropUnownedAttachmentRefs(m.parts, owned) }))
        .filter((m) => m.parts.length)
        .map((m) => ({ id: m.id, conversationId: conversation.id, role: 'user' as const, parts: m.parts }));

    // 消息与会话 updatedAt 必须原子推进：批量写消息 + bump 会话时间放同一事务。
    await db.transaction(async (tx) => {
        if (rowsToInsert.length) {
            await tx.insert(messagesTable).values(rowsToInsert).onConflictDoNothing();
        }
        await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
    });

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
                const prevText = partsToText(prevUserMsg?.parts).trim();
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
    /**
     * 私有桶附件在历史里以站内路径 `/api/attachments/{id}/raw` 形式保存：
     * 浏览器能带 cookie 读取（会话 UI 正常显示），但**模型侧无法抓取**该地址。
     * 直接交给 convertToModelMessages 会让部分供应商尝试下载并失败，
     * 因此这里把这类 part 转成文字说明，模型至少知道"用户附了一个什么文件"。
     */
    const toModelParts = (parts: unknown[]) =>
        parts.map((part) => {
            const p = part as { type?: string; url?: string; filename?: string; mediaType?: string };
            if ((p?.type === 'file' || p?.type === 'image') && typeof p.url === 'string' && p.url.startsWith('/api/')) {
                return {
                    type: 'text' as const,
                    text: `[用户附带了文件：${p.filename || '未命名'}（${p.mediaType || '未知类型'}）]`,
                };
            }
            return part;
        });

    const modelMessages = await convertToModelMessages(
        optimizedWindow.map((m) => ({ id: '', role: m.role as UIMessage['role'], parts: toModelParts(m.parts as unknown[]) as UIMessage['parts'] })),
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

    // onError 与 onFinish 可能都触发，客户端中途断开则一个都不触发；
    // 用一次性闭包保证 MCP 连接恰好关闭一次，避免重复 close 抛错或连接泄漏。
    let mcpClosed = false;
    const closeMcpOnce = () => {
        if (mcpClosed) return Promise.resolve();
        mcpClosed = true;
        return closeMcpConnections(mcpConnections);
    };

    const responseStream = createUIMessageStream({
        execute: ({ writer }) => {
            writer.merge(result.toUIMessageStream({ sendStart: false, sendReasoning: true }));
        },
        onError: (error) => {
            void closeMcpOnce();
            // 不把供应商/SQL 的原始错误文本透给终端用户，仅在服务端日志保留细节。
            console.error('[chat] 生成失败:', error);
            return '生成回复时出错，请稍后重试';
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
                await closeMcpOnce();
            }
        },
    });

    return createUIMessageStreamResponse({
        stream: responseStream,
        headers: { 'x-conversation-id': conversation.id },
    });
});
