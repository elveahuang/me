import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, streamText, type UIMessage } from 'ai';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
    agentKnowledgeBases,
    agentMcpServers,
    agentSkills,
    agentTools,
    agents,
    attachments as attachmentsTable,
    conversations,
    knowledgeBases,
    messages as messagesTable,
    skills,
    spaces,
    tools as toolsTable,
} from '../db/schema';
import { beginChatRun, endChatRun, tapChatRun, type ChatRun } from '../utils/chat-runs';
import { retrieveContext } from '../utils/embedding';
import { JSONB_MAX_DEPTH, exceedsJsonDepth } from '../utils/jsonb-input';
import { isTextLikeAttachment, readAttachmentBuffer } from '../utils/kb-ingest';
import { LOCAL_TOOL_SUMMARY, buildLocalFileTools } from '../utils/local-tools';
import { closeMcpConnections, connectEnabledMcpServers, mergeMcpTools } from '../utils/mcp';
import { requireMethod } from '../utils/method';
import { LOCAL_OWNER } from '../utils/owner';
import { stripNull, stripNullDeep } from '../utils/pg-text';
import { resolveModel } from '../utils/providers';
import { rateLimit } from '../utils/rate-limit';
import { lockAgentRow } from '../utils/ref-lock';
import { capBody, readCappedJsonBody } from '../utils/request-body';
import { buildSelfConfigTool } from '../utils/self-config';
import { resolveOptionalSpaceId } from '../utils/spaces';
import { buildSystemPrompt } from '../utils/system-prompt';
import { buildToolSet } from '../utils/tools';
import { WORKBENCH_TOOL_SUMMARY, buildWorkbenchTools } from '../utils/workbench-tools';

/** 发送给模型的上下文窗口（最近 N 条消息），控制长会话的 token 成本 */
const MAX_CONTEXT_MESSAGES = 24;

/**
 * 单次工具执行的时间预算（streamText 的 `timeout.toolMs`）。
 *
 * `@ai-sdk/mcp` 生成的工具 execute 只把 `options.abortSignal` 往下传、自己不带任何 timeout，
 * 而这里此前也没有给 streamText 传中止信号，所以一台在 `tools/call` 上不回包的 MCP 服务器
 * 会把这条 SSE、本轮已经烧掉的 token 和整批 MCP 连接挂住最长约 300 秒——`closeMcpOnce()` 只挂在
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
    const kept = parts.filter((part) => {
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
    // 整棵树剔除 NUL（jsonb 不接受 U+0000）。不能只处理 text part 的 text 字段：
    // `data` part 的载荷、`file` part 的 filename/mediaType、对象键都可能是字符串，
    // 漏一处就是一条 `Failed query: insert into "messages" (…)` 带整张列清单进响应体。
    // 用户侧与 assistant 侧共用同一条规则（见 onFinish 里的调用）。
    return stripNullDeep(kept);
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
 * 校验站内附件引用确实存在（一次查库拿回全部合法 id）。
 * 只做格式校验不够：伪造的 `/api/attachments/{不存在的id}/raw` 会原样进入模型上下文，
 * 再被 assistant 回复引用成一条永久死链。返回库里真实存在的 id 集合。
 *
 * 数量同样要夹住：引用是从请求体 parts 里收集的，不设上限就会把 inArray 撑成一条
 * 上万元素的 SQL。真实客户端每条消息最多带 5 个附件，超出的引用按「无法解析」丢弃。
 */
const MAX_ATTACHMENT_REFS = 500;

async function existingAttachmentIds(ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)].slice(0, MAX_ATTACHMENT_REFS);
    if (!unique.length) return new Set();
    const rows = await db.select({ id: attachmentsTable.id }).from(attachmentsTable).where(inArray(attachmentsTable.id, unique));
    return new Set(rows.map((row) => row.id));
}

/** 丢弃引用了不存在附件的 part，其余原样保留 */
function dropUnresolvableAttachmentRefs(parts: unknown[], existing: Set<string>): unknown[] {
    return parts.filter((p) => {
        const url = (p as { url?: unknown })?.url;
        if (typeof url !== 'string' || !url.startsWith('/')) return true;
        const id = internalAttachmentId(url);
        return id ? existing.has(id) : false;
    });
}

/**
 * 单次请求最多落库的 user 消息条数。
 *
 * 512KB 的体积闸门只约束了字节数：把消息压到 `{"id":"…","parts":[{"type":"text","text":""}]}`
 * 这种最小形状，一次请求可以塞进上万条，全部展开成单条 INSERT 的 values（一次请求写一万行）。
 * 真实客户端（AI SDK 的 DefaultChatTransport）确实会带上整段本地历史，所以不能按条数报错，
 * 只能从**末尾**保留：更早的 user 消息在它产生那一轮就已经落库，截掉旧的不会丢任何东西。
 */
const MAX_MESSAGES_PER_REQUEST = 500;

/** 会话 id 由服务端 crypto.randomUUID() 生成、列为 text：畸形串不会报错，只会「查不到 → 另起一条新会话」，故先夹住 */
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
 * 必须在建会话与落库之前调用：后续代码会对 `m.parts.filter(...)`、`m.role` 取值，
 * 数组里混进 null/字符串/无 parts 的对象会在半途抛 TypeError，用户拿到一个 500、
 * 侧栏却多出一条已经写了半截消息的会话。畸形条目按与 sanitizeUserParts 一致的策略丢弃。
 */
function normalizeIncomingMessages(value: unknown): UIMessage[] {
    if (!Array.isArray(value)) return [];
    return value.filter((m): m is UIMessage => {
        if (!m || typeof m !== 'object') return false;
        const candidate = m as { role?: unknown; parts?: unknown };
        if (typeof candidate.role !== 'string' || !Array.isArray(candidate.parts)) return false;
        // 深度闸门：下面那条 512KB 体积预检用的是 JSON.stringify，而 V8 的序列化器是递归的——
        // 实测 2 万层嵌套的 `data` part 会先在那里抛「Maximum call stack size exceeded」变成 500。
        // 按条丢弃（而不是整请求 400）沿用本函数既有的策略：真实客户端带的是整段本地历史，
        // 一条形状离谱的消息不该让这一轮全部发不出去。
        return !exceedsJsonDepth(candidate.parts, JSONB_MAX_DEPTH);
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
    requireMethod(event, ['POST']);
    await capBody(event, MAX_CHAT_BODY_BYTES);

    // 1. 分布式限流：本机单主，按整个应用计每分钟最多 30 次请求
    const limited = await rateLimit(`chat:${LOCAL_OWNER}`, 30, 60_000);
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

    const body = await readCappedJsonBody<{ messages: unknown; conversationId?: unknown; agentId?: unknown; spaceId?: unknown }>(event, MAX_CHAT_BODY_BYTES);
    const incoming = normalizeIncomingMessages(body?.messages);
    const agentId = typeof body?.agentId === 'string' ? body.agentId : '';
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
    const requestedSpaceId = typeof body?.spaceId === 'string' ? body.spaceId : undefined;

    // 必须带一条 user 消息（内容能否落库由 1.5 判定）：只传 assistant 消息同样会走完校验与生成，
    // 但服务端没有任何新输入可落库，等于白跑一轮模型调用。
    if (!agentId) {
        throw createError({ statusCode: 400, statusMessage: 'agentId 与 messages 必填' });
    }

    // 会话 id 是 text 列的等值查询：非法值不会报错，而是走「查不到 → 另起一条新会话」，
    // 用户以为在续聊原来那条，实际内容落进了一个新名字下。这里先夹住，让畸形 id 得到明确的 400。
    if (conversationId && !UUID_RE.test(conversationId)) {
        throw createError({ statusCode: 400, statusMessage: 'conversationId 非法' });
    }

    // agentId 走同一条形状闸门，但它挡的是另一件事：下面第一步就是 `eq(agents.id, agentId)`，
    // 而 PostgreSQL 对**参数**里的 U+0000 直接报 22021——一个带 NUL 的 agentId 会在读智能体那一步
    // 就 500，并把 agents 表的整张列清单写进响应体。work 的 id 全部来自 crypto.randomUUID()，
    // 形状检查没有兼容代价，顺带也替「查不到 → 404」拿到了正确的语义。
    if (!UUID_RE.test(agentId)) {
        throw createError({ statusCode: 400, statusMessage: 'agentId 非法' });
    }

    // 防滥用：归一后的消息内容仍要过 512KB —— 请求体上限管的是"读了多少字节"，
    // 这条管的是"准备落库/进模型的内容有多少"，客户端塞满转义与无效 part 时两者会明显背离。
    if (JSON.stringify(incoming).length > MAX_MESSAGE_BYTES) {
        throw createError({ statusCode: 400, statusMessage: '消息体积过大（上限 512KB）' });
    }

    /**
     * 1.5 本轮要落库的用户消息：先清洗成形，再判「这一轮到底有没有内容」——这条判定必须在建会话之前。
     *
     * 早先的预检只看 `role === 'user'` 是否存在，但 parts 还要再过两道会丢内容的闸门：
     * `sanitizeUserParts()` 的类型/part 白名单，以及站内附件的存在性过滤。于是
     * `{"role":"user","parts":[{"type":"text","text":123}]}`（text 非字符串）、`parts: []`、
     * 或只带一个已经不在库里的 `/api/attachments/<id>/raw`，都会一路走完校验、
     * 新建一条标题为「新对话」的空会话，再拿一段没有任何新输入的上下文去跑模型——
     * 侧栏多出一条空会话，供应商若在空上下文上报错还算成用户的失败。
     * 附件引用只查一次库（整批引用一次 IN），不按消息逐条往返。work 是单主的本机应用、
     * 附件表没有归属列，所以这里过滤的是「引用了库里不存在的 id」的 part，而不是他人附件。
     */
    const candidateMessages = incoming
        .filter((m) => m.role === 'user')
        .map((m) => ({
            // id 是主键且必填：客户端未带 id 时服务端补一个，否则 insert 会因 undefined 参数报 500。
            // 主键是 text 列，客户端带的 id 里也可能有 NUL（jsonb 之外它自己就是第一个炸的）
            id: typeof m.id === 'string' && m.id.trim() ? stripNull(m.id) : `cmsg_${crypto.randomUUID()}`,
            parts: sanitizeUserParts(m.parts),
        }))
        .filter((m) => m.parts.length);

    const existing = await existingAttachmentIds(candidateMessages.flatMap((m) => collectInternalAttachmentIds(m.parts)));
    const userMessages = candidateMessages
        .map((m) => ({ id: m.id, parts: dropUnresolvableAttachmentRefs(m.parts, existing) }))
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

    // 3. 入参、附件引用与「本轮有没有内容」都已在上面判完；work 没有按次计费环节，直接进能力加载

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
        const spaceId = await resolveOptionalSpaceId(requestedSpaceId);
        // 第 2 步那次读只是快路径（顺带把「已停用」挡在前面）。从它到这里之间，另一个标签页可以完整地
        // 删掉这个智能体（`settings/agents/[id].ts` 的 DELETE 在事务里对该行取 FOR UPDATE），
        // 于是这条裸 INSERT 撞 23503：响应变成 500 + drizzle 的整张列清单，用户刚打的那句话没有任何地方落库。
        // 锁内重读父行，没了就回可读的 404——与 POST /api/conversations 同一口径。
        await db.transaction(async (tx) => {
            await lockAgentRow(tx, agentId);
            await tx.insert(conversations).values({
                id: newId,
                agentId,
                spaceId,
                title: lastUserText.slice(0, 30) || '新对话',
            });
        });
        row = (await db.select().from(conversations).where(eq(conversations.id, newId)))[0];
    } else if (row.agentId !== agentId) {
        /**
         * 会话与智能体的归属不能跨。
         *
         * 此前只有客户端在兜这条（切换智能体时父级清空 conversationId），服务端读到自己已有的
         * 会话就直接续聊：换进来的系统提示词/工具/知识库会作用在另一个智能体的历史上，
         * 生成的轮次再落回原会话——之后按原智能体打开，读到的是别的提示词写出来的内容。
         * 这条边界写在服务端，是因为它属于数据不变量，不能只靠前端纪律维持。
         */
        throw createError({ statusCode: 400, statusMessage: 'conversationId 与 agentId 不匹配，请新建会话后再切换智能体' });
    } else if ((row.title === '新对话' || !row.title) && lastUserText.trim()) {
        const autoTitle = lastUserText.trim().slice(0, 30);
        await db.update(conversations).set({ title: autoTitle, updatedAt: new Date() }).where(eq(conversations.id, row.id));
        row.title = autoTitle;
    }
    const conversation = row!;
    const [space] = conversation.spaceId
        ? await db
              .select({ name: spaces.name, instructions: spaces.instructions, localRoot: spaces.localRoot })
              .from(spaces)
              .where(eq(spaces.id, conversation.spaceId))
        : [];
    const spaceKbIds = boundKbIds.length
        ? (
              await db
                  .select({ id: knowledgeBases.id })
                  .from(knowledgeBases)
                  .where(
                      and(
                          inArray(knowledgeBases.id, boundKbIds),
                          conversation.spaceId
                              ? or(eq(knowledgeBases.spaceId, conversation.spaceId), isNull(knowledgeBases.spaceId))
                              : isNull(knowledgeBases.spaceId),
                      ),
                  )
          ).map((item) => item.id)
        : [];

    // 6. 落库客户端消息（按消息 id 幂等）
    //    清洗、附件存在性过滤与「本轮无可落库内容」的判定都在建会话之前完成（见步骤 1.5），
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
    if (spaceKbIds.length && lastUserText.trim()) {
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

            const { context, hits } = await retrieveContext(spaceKbIds, searchKeyword);
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
    //     工作台内置工具恒常挂载（不依赖智能体绑定）：这是本机私人事物，
    //     用户说「每天九点跑一遍」「今天有什么安排」时不该取决于所选智能体恰好绑了哪几行工具。
    //     agentId 是新建定时任务的归属：到点执行哪个智能体由「用户在哪段对话里提的」决定，而不是让模型挑。
    const localTools = buildLocalFileTools(space?.localRoot || undefined);
    let toolSet = {
        ...buildWorkbenchTools(agentId, conversation.spaceId),
        ...localTools,
        ...buildToolSet(boundTools.map((row) => row.tool)),
    };
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
    let activeRun: ChatRun | null = null;
    try {
        if (mcpConnections.length) {
            toolSet = mergeMcpTools(toolSet, mcpConnections);
        }

        // 11. 组装系统提示词
        const toolSummary = [
            WORKBENCH_TOOL_SUMMARY,
            ...(Object.keys(localTools).length ? [LOCAL_TOOL_SUMMARY] : []),
            ...boundTools.map((row) => `- ${row.tool.name}（${row.tool.type === 'http' ? 'HTTP 工具' : '内置工具'}）：${row.tool.description}`),
            ...mcpConnections.map((c) => `- [MCP] ${c.serverName}`),
        ].join('\n');

        const system = buildSystemPrompt(agent, boundSkills as any, knowledgeContext, toolSummary.trim() ? toolSummary : null, undefined, space);

        // 12. 流式生成（带温度、Token 限制与思维链传递）
        /**
         * 私有桶附件在历史里以站内路径 `/api/attachments/{id}/raw` 形式保存：
         * 浏览器能带 cookie 读取（会话 UI 正常显示），但**模型侧无法直接抓取**该相对地址。
         * 对最近 6 条消息内的站内附件：
         * - 文本/代码类（<=64KB）直接从 S3 读取 UTF-8 正文注入模型消息
         * - 图片类（<=4MB）读取并转为 base64 Data URL 供多模态模型直接查看
         * - 其余（过早历史、大体积二进制或读取失败）安全回退为文件名说明
         */
        const MAX_INLINE_TEXT_BYTES = 64 * 1024;
        const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
        const resolveModelParts = async (parts: unknown[], isRecent: boolean) =>
            Promise.all(
                parts.map(async (part) => {
                    const p = part as { type?: string; url?: string; filename?: string; mediaType?: string };
                    if ((p?.type === 'file' || p?.type === 'image') && typeof p.url === 'string' && p.url.startsWith('/api/')) {
                        const stub = {
                            type: 'text' as const,
                            text: `[用户附带了文件：${p.filename || '未命名'}（${p.mediaType || '未知类型'}）]`,
                        };
                        if (!isRecent) return stub;
                        const attId = internalAttachmentId(p.url);
                        if (!attId) return stub;
                        try {
                            const filename = p.filename || '未命名';
                            const mediaType = p.mediaType || 'application/octet-stream';
                            if (isTextLikeAttachment(filename, mediaType)) {
                                const { buffer, truncated } = await readAttachmentBuffer(attId, MAX_INLINE_TEXT_BYTES, true);
                                const content = stripNull(buffer.toString('utf-8')).trim();
                                if (!content) return stub;
                                return {
                                    type: 'text' as const,
                                    text: `[用户附带了文件：${filename}（${mediaType}）${truncated ? '（已截取前 64KB）' : ''}]\n\`\`\`\n${content}\n\`\`\``,
                                };
                            }
                            if (mediaType.toLowerCase().startsWith('image/')) {
                                const { buffer } = await readAttachmentBuffer(attId, MAX_INLINE_IMAGE_BYTES, false);
                                return {
                                    ...p,
                                    url: `data:${mediaType};base64,${buffer.toString('base64')}`,
                                };
                            }
                        } catch {
                            return stub;
                        }
                        return stub;
                    }
                    return part;
                }),
            );

        const resolvedWindow = await Promise.all(
            optimizedWindow.map(async (m, idx) => ({
                id: '',
                role: m.role as UIMessage['role'],
                parts: (await resolveModelParts(m.parts as unknown[], idx >= optimizedWindow.length - 6)) as UIMessage['parts'],
            })),
        );

        const modelMessages = await convertToModelMessages(resolvedWindow, { ignoreIncompleteToolCalls: true });
        const maxSteps = agent.maxSteps ?? 6;

        /**
         * 每一轮生成先开一条内存回放缓冲（`utils/chat-runs.ts`），让「切会话 / 切页面 / 刷新」后的
         * 重连还能把这一轮逐字看完；顺带拿到这一轮的 `AbortController`。
         *
         * 必须在 `streamText` 之前建：abortSignal 要在调用模型时就已就位，而缓冲本身只是旁路，
         * 真正的响应流仍是原来那条——客户端断开时该轮照常跑完并落库，`停止` 则走下面这条信号。
         */
        const run = beginChatRun(conversation.id);
        activeRun = run;
        const result = streamText({
            model,
            system: system || undefined,
            messages: modelMessages,
            tools: toolSet,
            temperature: agent.temperature ?? undefined,
            maxOutputTokens: agent.maxTokens ?? undefined,
            stopWhen: stepCountIs(maxSteps),
            timeout: { toolMs: TOOL_TIMEOUT_MS, firstChunkMs: FIRST_CHUNK_TIMEOUT_MS, chunkMs: CHUNK_TIMEOUT_MS },
            abortSignal: run.controller.signal,
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
                                parts: stripNullDeep(assistantMessage.parts ?? []),
                            })
                            .onConflictDoNothing();
                        if (isAborted) {
                            console.info(`[chat] 用户中断生成，已保存已产出的部分回复（conversation=${conversation.id}）`);
                        }
                    }
                } catch (error) {
                    // 落库失败绝不能从 onFinish 抛出去。上面那条 onError 脱敏只对「生成阶段」的错误生效：
                    // ai@7 把 onFinish 挂在流末尾 TransformStream 的 flush()/cancel() 上，那条路径没有 try/catch
                    // （对比它给 onStepFinish 就包了一层），实测抛出的 message 会原样出现在响应流里、
                    // 绕开脱敏把 `Failed query: insert into "messages" (...)` 连列清单一起送给浏览器；
                    // 而客户端断开走的是 cancel 分支，同一条抛出还会让收尾永不结算。
                    // 回复丢了可以重来，一条 SQL 原文泄出去收不回来，所以这里只记日志。
                    console.error('[chat] 保存助手回复失败:', error);
                } finally {
                    try {
                        await closeMcpOnce();
                    } catch (error) {
                        // finally 里抛出会顶掉上面已经做好的收尾，且同样没人接——连接关掉失败只该有日志
                        console.error('[chat] 关闭 MCP 连接失败:', error);
                    }
                }
            },
        });

        /**
         * 缓冲只是旁路：这条响应流与改动前逐字节相同，客户端断开（切页面 / 刷新）不影响这一轮跑完并落库。
         * 真正会中断这一轮的是 `POST /api/chat/{会话 id}/stop`——它 abort 上面那个 controller。
         */
        return createUIMessageStreamResponse({
            stream: tapChatRun(responseStream, run),
            headers: { 'x-conversation-id': conversation.id },
        });
    } catch (error) {
        // 流还没交出去就抛错（合并工具、拼提示词、转换历史都可能）：onFinish/onError 都还没机会跑，
        // 不把这一轮收尾就会留一条永远「在途」的缓冲，侧栏角标一直亮到 5 分钟 stale 兜底。
        if (activeRun) endChatRun(activeRun);
        await closeMcpOnce();
        throw error;
    }
});
