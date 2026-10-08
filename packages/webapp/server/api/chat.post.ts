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
import { readCappedJsonBody } from '../utils/request-body';
import { buildSelfConfigTool } from '../utils/self-config';
import { buildSystemPrompt } from '../utils/system-prompt';
import { buildToolSet } from '../utils/tools';

/** 发送给模型的上下文窗口（最近 N 条消息），控制长会话的 token 成本 */
const MAX_CONTEXT_MESSAGES = 24;

/**
 * 单次工具执行的时间预算（streamText 的 `timeout.toolMs`）。
 *
 * `@ai-sdk/mcp` 生成的工具 execute 只把 `options.abortSignal` 往下传、自己不带任何 timeout，
 * 而这里此前也没有给 streamText 传中止信号，所以一台在 `tools/call` 上不回包的 MCP 服务器
 * 会把这条 SSE、本轮已扣的额度和整批 MCP 连接挂住最长约 300 秒——`closeMcpOnce()` 只挂在
 * onError/onFinish 上，流不结束就不跑。约 300 秒是 undici 的兜底而不是无限：实测「接受连接后
 * 不回响应体」在 +305.1s 抛 `AI_APICallError: Failed to process successful response`，
 * 完全不回响应头在 +304.7s 抛 `HeadersTimeoutError`。几百秒的占用足够让限流、连接池和用户都失去意义，
 * 所以预算仍然要设在应用层。
 *
 * 30 秒高于内置 HTTP 工具自带的 15 秒出站上限，不会误伤它们。行为已在安装版 ai@7.0.109
 * 上用 mock provider 逐项验证：同一步里的多个工具调用是并发执行的（N 个工具同时卡住也只花
 * 一个预算的时间），超时/抛错的那一条在 SDK 侧记为 `tool-error`、在协议侧以
 * `output.type === 'error-text'` 的 tool-result 回喂给模型，成功同伴的结果照常保留，
 * agent 循环继续走下一步直到给出最终回答。
 */
const TOOL_TIMEOUT_MS = 30_000;

/**
 * 模型侧的流预算（streamText 的 `timeout.firstChunkMs` / `timeout.chunkMs`）。
 *
 * `toolMs` 只管「工具执行」这一格；供应商接受连接后不回任何内容、或吐了半句就停住，
 * SDK 侧完全没有预算（实测：不带 timeout 的 mock 流永不调 finish，`onError`/`onFinish`
 * 都不触发——mock 没有网络层，是真·永挂；真实供应商则由 undici 默认值兜到约 300 秒，
 * 见上面 `TOOL_TIMEOUT_MS` 那段）。这两个值是**每一步**独立计数的
 * 「首个内容块」与「相邻内容块间隔」，所以正常的长回答不会因为总时长被误杀。
 *
 * 60 秒刻意高于 `TOOL_TIMEOUT_MS`：带工具的那一步里，模型输出结束后到下一步首个块之间
 * 夹着最长 30 秒的工具执行，取 60 秒保证这一步永远不可能被工具时间吃满预算。
 * 预算落败即整次生成结束（实测 abort 后流在预算点收尾而非永挂），但已产出的文本仍留在
 * 最终消息里，UI 流照常结束，所以 `onFinish` 会保存这条部分回复。
 */
const FIRST_CHUNK_TIMEOUT_MS = 60_000;
const CHUNK_TIMEOUT_MS = 60_000;

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
 *
 * 数量同样要夹住：引用是从请求体 parts 里收集的，不设上限就会把 inArray 撑成一条
 * 上万元素的 SQL。真实客户端每条消息最多带 5 个附件，超出部分按「非本人引用」丢弃。
 */
const MAX_ATTACHMENT_REFS = 500;

async function ownedAttachmentIds(ids: string[], userId: string): Promise<Set<string>> {
    const unique = [...new Set(ids)].slice(0, MAX_ATTACHMENT_REFS);
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

/**
 * 单次请求最多落库的 user 消息条数。
 *
 * 512KB 的体积闸门只约束了字节数：把消息压到 `{"id":"…","parts":[{"type":"text","text":""}]}`
 * 这种最小形状，一次请求可以塞进上万条，全部展开成单条 INSERT 的 values（一次扣额写一万行）。
 * 真实客户端（AI SDK 的 DefaultChatTransport）确实会带上整段本地历史，所以不能按条数报错，
 * 只能从**末尾**保留：更早的 user 消息在它产生那一轮就已经落库，截掉旧的不会丢任何东西。
 */
const MAX_MESSAGES_PER_REQUEST = 500;

/** 会话 id 由服务端 crypto.randomUUID() 生成、列为 text：畸形串不会报错，只会查不到而白扣配额，故先夹住 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 归一后消息内容的上限（落库与进模型前各自还要按条数/part 白名单夹）。
 */
const MAX_MESSAGE_BYTES = 512 * 1024;

/**
 * 请求体硬上限：给 JSON 转义与空白留一倍余量。Content-Length 命中即快速拒绝，
 * 实际字节数由 readCappedJsonBody 兜底——chunked 请求没有长度头，只信 header 等于没有上限。
 */
const MAX_CHAT_BODY_BYTES = 2 * MAX_MESSAGE_BYTES;

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

    // 与中转上传同一前置闸门思路：请求体会被整个读进内存，512KB 检查在解析后才执行挡不住并发巨型体。
    // Content-Length 只当作快速拒绝（省掉白读），真正的上限在 `readCappedJsonBody` 里按实际字节执行——
    // chunked 请求没有长度头，`Transfer-Encoding: chunked` 时这里根本进不来。
    const contentLength = Number(getHeader(event, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_CHAT_BODY_BYTES) {
        throw createError({ statusCode: 413, statusMessage: '请求体过大（上限 512KB 消息内容）' });
    }

    const body = await readCappedJsonBody<{ messages: unknown; conversationId?: unknown; agentId?: unknown }>(event, MAX_CHAT_BODY_BYTES);
    const incoming = normalizeIncomingMessages(body?.messages);
    const agentId = typeof body?.agentId === 'string' ? body.agentId : '';
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';

    // 必须带一条 user 消息（内容能否落库由 1.5 判定）：只传 assistant 消息同样会走完扣额与生成，
    // 但服务端没有任何新输入可落库，等于用一次配额触发一轮无意义的模型调用。
    if (!agentId) {
        throw createError({ statusCode: 400, statusMessage: 'agentId 与 messages 必填' });
    }

    // 会话 id 是 text 列的等值查询：非法值不会报错，但会在**扣额之后**才查不到而 404，
    // 这里先夹住，让无效或过期的 id 得到一个明确的 400 而不是白扣配额。
    if (conversationId && !UUID_RE.test(conversationId)) {
        throw createError({ statusCode: 400, statusMessage: 'conversationId 非法' });
    }

    // 防滥用：归一后的消息内容仍要过 512KB —— 请求体上限管的是"读了多少字节"，
    // 这条管的是"准备落库/进模型的内容有多少"，客户端塞满转义与无效 part 时两者会明显背离。
    if (JSON.stringify(incoming).length > MAX_MESSAGE_BYTES) {
        throw createError({ statusCode: 400, statusMessage: '消息体积过大（上限 512KB）' });
    }

    /**
     * 1.5 本轮要落库的用户消息：先清洗成形，再判「这一轮到底有没有内容」——这条判定必须在扣额之前。
     *
     * 早先的预检只看 `role === 'user'` 是否存在，但 parts 还要再过两道会丢内容的闸门：
     * `sanitizeUserParts()` 的类型/part 白名单，以及站内附件的归属过滤。于是
     * `{"role":"user","parts":[{"type":"text","text":123}]}`（text 非字符串）、`parts: []`、
     * 或只带一个别人的 `/api/attachments/<他人id>/raw`，都会一路走完扣额、
     * 新建一条标题为「新对话」的空会话，再拿一段没有任何新输入的上下文去跑模型——
     * 用户损失一次配额、侧栏多出一条空会话，供应商若在空上下文上报错还算成他的失败。
     * 附件归属只查一次库（整批引用一次 IN），不在扣额后按消息逐条往返；
     * 它只按当前用户 id 取自己的行、不涉及会话所有权，所以可以安全放在扣额之前
     * （会话归属校验仍在扣额之后，是既有语义）。
     */
    const candidateMessages = incoming
        .filter((m) => m.role === 'user')
        .map((m) => ({
            // id 是主键且必填：客户端未带 id 时服务端补一个，否则 insert 会因 undefined 参数报 500。
            id: typeof m.id === 'string' && m.id.trim() ? m.id : `cmsg_${crypto.randomUUID()}`,
            parts: sanitizeUserParts(m.parts),
        }))
        .filter((m) => m.parts.length);

    const owned = await ownedAttachmentIds(
        candidateMessages.flatMap((m) => collectInternalAttachmentIds(m.parts)),
        session.user.id,
    );
    const userMessages = candidateMessages
        .map((m) => ({ id: m.id, parts: dropUnownedAttachmentRefs(m.parts, owned) }))
        .filter((m) => m.parts.length)
        .slice(-MAX_MESSAGES_PER_REQUEST);

    if (!userMessages.length) {
        throw createError({ statusCode: 400, statusMessage: '没有可落库的用户消息内容' });
    }

    // 2. 智能体必须存在且启用
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent || !agent.enabled) {
        throw createError({ statusCode: 404, statusMessage: '智能体不存在或未启用' });
    }

    // 3. 校验并原子消耗一次当日对话配额（超限直接抛出 402）
    //    归属校验放在扣额之后是既有语义（见下），不要为了"少扣一次"把读会话提前。
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

    // 标题与 RAG 检索词都取「本轮真正落库的那条」：从原始 incoming 取会给一条被整条丢弃的消息
    // 起出标题，会话凭空多出一个与内容无关的名字。
    const lastUserText = partsToText(userMessages[userMessages.length - 1]?.parts);

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
        throw createError({ statusCode: 403, statusMessage: '无权访问该会话' });
    } else if (row.agentId !== agentId) {
        /**
         * 会话与智能体的归属不能跨。
         *
         * 此前只有客户端在兜这条（切换智能体时父级清空 conversationId），服务端读到自己用户的
         * 会话就直接续聊：换进来的系统提示词/工具/知识库会作用在另一个智能体的历史上，
         * 生成的轮次再落回原会话——之后按原智能体打开，读到的是别的提示词写出来的内容。
         * 与所有权检查同处，是因为这条边界属于数据不变量，不能只靠前端纪律维持。
         */
        throw createError({ statusCode: 400, statusMessage: 'conversationId 与 agentId 不匹配，请新建会话后再切换智能体' });
    } else if ((row.title === '新对话' || !row.title) && lastUserText.trim()) {
        const autoTitle = lastUserText.trim().slice(0, 30);
        await db.update(conversations).set({ title: autoTitle, updatedAt: new Date() }).where(eq(conversations.id, row.id));
        row.title = autoTitle;
    }
    const conversation = row!;

    // 6. 落库客户端消息（按消息 id 幂等）
    //    清洗、附件归属过滤与「本轮无可落库内容」的判定都在扣额之前完成（见步骤 1.5），
    //    这里只把已定形的消息挂上会话并写入。
    //    只接受 user 角色：服务端历史是上下文唯一事实来源，
    //    否则客户端可以伪造 assistant 回复与 tool 结果污染后续所有轮次。
    const rowsToInsert = userMessages.map((m) => ({ id: m.id, conversationId: conversation.id, role: 'user' as const, parts: m.parts }));

    // 消息与会话 updatedAt 必须原子推进：批量写消息 + bump 会话时间放同一事务。
    await db.transaction(async (tx) => {
        await tx.insert(messagesTable).values(rowsToInsert).onConflictDoNothing();
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

    // onError 与 onFinish 可能都触发（流被 cancel 时 onFinish 同样会跑，不是「断开就什么都不跑」）；
    // 用一次性闭包保证 MCP 连接恰好关闭一次，避免重复 close 抛错或连接泄漏。
    let mcpClosed = false;
    const closeMcpOnce = () => {
        if (mcpClosed) return Promise.resolve();
        mcpClosed = true;
        return closeMcpConnections(mcpConnections);
    };

    // 连接一建立就进入保护区：下面到「流真正跑起来」之间还有 buildToolSet/mergeMcpTools、
    // buildSystemPrompt、convertToModelMessages、streamText 多处可抛错，而 onError/onFinish
    // 只有流已建立后才有机会触发。任一处抛出都会让 handler 直接 500，不先关闭就把整批
    // MCP 连接（及其子进程/长连接）永久漏在进程里。
    try {
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
            // 中断的那一轮会把「只有入参、没有结果」的工具调用原样落库（onFinish 在流被 cancel 时
            // 同样会跑，且落库只看 parts 非空、不看 isAborted）。这种 part 会发出一个没有配套
            // tool 结果的 tool_calls，OpenAI 兼容端点据此 400 掉整次请求，于是该会话此后每轮都失败、
            // 每轮都照扣一次额度，直到那条历史滑出 24 条窗口。读取侧过滤同时能救回已被污染的既有会话。
            { ignoreIncompleteToolCalls: true },
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
            timeout: { toolMs: TOOL_TIMEOUT_MS, firstChunkMs: FIRST_CHUNK_TIMEOUT_MS, chunkMs: CHUNK_TIMEOUT_MS },
        });

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
    } catch (error) {
        await closeMcpOnce();
        throw error;
    }
});
