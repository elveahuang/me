import type { UIMessage } from 'ai';
import { inArray } from 'drizzle-orm';
import { attachments as attachmentsTable } from '../db/schema';
import { db } from './db';
import { JSONB_MAX_DEPTH, exceedsJsonDepth } from './jsonb-input';
import { stripNullDeep } from './pg-text';

/**
 * `/api/chat` 的入参清洗与预算常量。
 *
 * 从路由文件里抽出来的一层：handler 只保留「限流 → 闸门 → 清洗 → 落库 → 装配 → 流式」的
 * 编排步骤，清洗规则（part 白名单、站内附件存在性、条数/字节预算）与它的历史踩坑注释
 * 集中在这里，改一处就能对照冒烟测试的对应断言。
 */

/** 发送给模型的上下文窗口（最近 N 条消息），控制长会话的 token 成本 */
export const MAX_CONTEXT_MESSAGES = 24;

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
export const TOOL_TIMEOUT_MS = 30_000;

/**
 * 模型侧的流预算（streamText 的 `timeout.firstChunkMs` / `timeout.chunkMs`）。
 *
 * `toolMs` 只管「工具执行」这一格；供应商接受连接后不回任何内容、或吐了半句就停住，
 * SDK 侧完全没有预算（实测：不带 timeout 的 mock 流永不调 finish，`onError`/`onFinish`
 * 都不触发——mock 没有网络层，是真·永挂；真实供应商则由 undici 默认值兜到约 300 秒，
 * 见 `TOOL_TIMEOUT_MS` 那段）。这两个值是**每一步**独立计数的
 * 「首个内容块」与「相邻内容块间隔」，所以正常的长回答不会因为总时长被误杀。
 *
 * 60 秒刻意高于 `TOOL_TIMEOUT_MS`：带工具的那一步里，模型输出结束后到下一步首个块之间
 * 夹着最长 30 秒的工具执行，取 60 秒保证这一步永远不可能被工具时间吃满预算。
 * 预算落败即整次生成结束（实测 abort 后流在预算点收尾而非永挂），但已产出的文本仍留在
 * 最终消息里，UI 流照常结束，所以 `onFinish` 会保存这条部分回复。
 */
export const FIRST_CHUNK_TIMEOUT_MS = 60_000;
export const CHUNK_TIMEOUT_MS = 60_000;

/** 用户消息里允许落库的 part 类型（assistant 专属的 reasoning / tool-* 不允许由客户端写入） */
const USER_PART_TYPES = new Set(['text', 'file', 'image', 'data']);

/**
 * 站内附件路径白名单：私有桶的附件以 `/api/attachments/{id}/raw` 形式保存
 * （见 /api/attachments/chat-parts）。这是唯一允许的相对地址形式——
 * 其他相对路径会被 AI SDK 的 `new URL()` 抛错，一旦落库就会让整个会话永久 500。
 */
const INTERNAL_ATTACHMENT_PATH = /^\/api\/attachments\/[0-9a-f-]{36}\/raw$/i;

/** 从站内路径里取出附件 id（非站内路径返回 null） */
export function internalAttachmentId(url: string): string | null {
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
export function sanitizeUserParts(parts: unknown): unknown[] {
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
export function collectInternalAttachmentIds(parts: unknown[]): string[] {
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

export async function existingAttachmentIds(ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)].slice(0, MAX_ATTACHMENT_REFS);
    if (!unique.length) return new Set();
    const rows = await db.select({ id: attachmentsTable.id }).from(attachmentsTable).where(inArray(attachmentsTable.id, unique));
    return new Set(rows.map((row) => row.id));
}

/** 丢弃引用了不存在附件的 part，其余原样保留 */
export function dropUnresolvableAttachmentRefs(parts: unknown[], existing: Set<string>): unknown[] {
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
export const MAX_MESSAGES_PER_REQUEST = 500;

/** 会话 id 由服务端 crypto.randomUUID() 生成、列为 text：畸形串不会报错，只会「查不到 → 另起一条新会话」，故先夹住 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 归一后消息内容的上限（落库与进模型前各自还要按条数/part 白名单夹）。
 */
export const MAX_MESSAGE_BYTES = 512 * 1024;

/**
 * 请求体硬上限：给 JSON 转义与空白留一倍余量。Content-Length 命中即快速拒绝，
 * 实际字节数由 readCappedJsonBody 兜底——chunked 请求没有长度头，只信 header 等于没有上限。
 */
export const MAX_CHAT_BODY_BYTES = 2 * MAX_MESSAGE_BYTES;

/**
 * 把客户端传入的 messages 夹成可安全遍历的形状，只保留 role/parts 结构合法的条目。
 *
 * 必须在建会话与落库之前调用：后续代码会对 `m.parts.filter(...)`、`m.role` 取值，
 * 数组里混进 null/字符串/无 parts 的对象会在半途抛 TypeError，用户拿到一个 500、
 * 侧栏却多出一条已经写了半截消息的会话。畸形条目按与 sanitizeUserParts 一致的策略丢弃。
 */
export function normalizeIncomingMessages(value: unknown): UIMessage[] {
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

/** 从 parts 中拼出纯文本，用于会话标题与 RAG 检索词（与 content_text 检索列的 partsToPlainText 不同：这里不换行、不截断） */
export function partsToText(parts: unknown): string {
    if (!Array.isArray(parts)) return '';
    return parts
        .filter(
            (p): p is { type: 'text'; text: string } => !!p && (p as { type?: unknown }).type === 'text' && typeof (p as { text?: unknown }).text === 'string',
        )
        .map((p) => p.text)
        .join('');
}
