import type { H3Event } from 'h3';

/**
 * 带硬上限地读取请求体原始字节，不做解码、不解析。
 *
 * h3 1.15 的 `readBody`/`readRawBody` 没有任何体积参数：它们先把整个请求体读进内存，再解析/返回。
 * 只按 `Content-Length` 预检等于把上限交给客户端自觉——`Transfer-Encoding: chunked`
 * 压根没有长度头，一条几百 MB 的请求就会被完整缓冲住（每用户限流按**次数**算，
 * 挡不住按字节放大的并发请求把 Nitro 进程内存吃光）。
 *
 * 这里自己按字节累计：一旦越限就丢掉已缓冲的分片并停止保存，但**继续把流读干**——
 * 直接 `req.destroy()` 会连响应一起撕掉，客户端只能看到连接重置而不是明确的 413。
 * 内存占用因此与请求体大小解耦；越限后剩下的字节只是白读带宽。
 */
/** 给 413 文案用的体积表述：MB 级闸门写成 KB 会得出「4160KB」这种读不出含义的数字 */
function formatByteLimit(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')}MB`;
    return `${Math.floor(bytes / 1024)}KB`;
}

export async function readCappedBodyBytes(event: H3Event, maxBytes: number): Promise<Buffer> {
    const req = event.node.req;
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;

    for await (const piece of req) {
        const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece as ArrayBuffer);
        if (exceeded) continue;
        if (size + chunk.length > maxBytes) {
            exceeded = true;
            chunks.length = 0;
            size = 0;
            continue;
        }
        chunks.push(chunk);
        size += chunk.length;
    }

    if (exceeded) {
        throw createError({ statusCode: 413, statusMessage: `请求体过大（上限 ${formatByteLimit(maxBytes)}）` });
    }

    return Buffer.concat(chunks);
}

/** h3 在 `node.req` 上缓存原始请求体用的 symbol（`Symbol.for('h3RawBody')`，跨模块实例同键）。 */
const H3_RAW_BODY = Symbol.for('h3RawBody');

/**
 * 按字节封顶读完请求体，并把结果塞回 h3 自己的缓存位，让后续的 `readMultipartFormData`/`readBody`
 * 复用这段已校验过的字节，而不是再消费一次流。
 *
 * multipart 必须这样收口：h3 的解析器只吃「已经全部读完的 Buffer」，
 * 所以真正的内存上界只能在读取阶段设，解析后再量 `part.data.length` 已经晚了。
 * h3 内部用的正是 `Symbol.for('h3RawBody')`（不是私有 symbol），且命中的值若是 Buffer 会**原样返回**
 * （不做二次编码），二进制正文因此保持逐字节一致。
 *
 * 前提是 `event` 由 Node 请求构造（本项目 `tools/deploy/dockerfile` 跑的是 nitro node preset）：
 * h3 取 raw body 的优先级是 `event._requestBody → event.web.request.body → req[Symbol]`，
 * 只有在以 Web Request 构造事件的 preset 下前两项才非空，那种情况下这里写入的缓存位会被忽略（闸门失效，但不会读错数据）。
 */
export async function readCappedBodyIntoH3Cache(event: H3Event, maxBytes: number): Promise<Buffer> {
    // 已经封顶读过一次就直接复用：流此时已经结束，再读会把缓存位覆盖成空 Buffer
    const cached = (event.node.req as unknown as Record<symbol, unknown>)[H3_RAW_BODY];
    if (Buffer.isBuffer(cached)) return cached;
    const bytes = await readCappedBodyBytes(event, maxBytes);
    (event.node.req as unknown as Record<symbol, Buffer>)[H3_RAW_BODY] = bytes;
    return bytes;
}

/**
 * 带硬上限地读取请求体文本（UTF-8）。用于需要拿原始报文做验签等非 JSON 解析的场景。
 */
export async function readCappedBodyText(event: H3Event, maxBytes: number): Promise<string> {
    return (await readCappedBodyBytes(event, maxBytes)).toString('utf8');
}

/**
 * 除 `/api/chat`（自带 512KB 单消息 / 1MB 整体的 messages 编排）与 multipart 中转上传（另一条路径，
 * 见 `storage.ts` 的 `assertRelayRequestAllowed`）之外，其余 JSON 接口共用的正文上限。
 * 这些接口的合法请求体都是 KB 级（一个 id 列表、一个标题、一个 objectKey），256KB 已留出一个数量级余量。
 */
const DEFAULT_JSON_BODY_BYTES = 256 * 1024;

/**
 * 管理端请求体的**粗粒度**上限（`requireAdmin` 鉴权通过后统一收口读取用）。
 * 它只负责把「无限缓冲」变成「有限缓冲」，不是各端点的业务上限：
 * 管理表单是 KB 级，1MB 已留出一个数量级余量；确需更大的端点（知识库文档正文 2MB）
 * 通过 `requireAdmin(event, { bodyLimitBytes })` 显式放大，别去动这个公共值。
 */
export const ADMIN_BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * 带硬上限地读取并解析 JSON 请求体。空请求体返回 `undefined`（与 `readBody` 一致），
 * 非法 JSON 直接回 400，而不是把解析异常抛成 500。
 */
export async function readCappedJsonBody<T>(event: H3Event, maxBytes = DEFAULT_JSON_BODY_BYTES): Promise<T> {
    const text = await readCappedBodyText(event, maxBytes);
    if (!text) return undefined as T;
    try {
        return JSON.parse(text) as T;
    } catch {
        throw createError({ statusCode: 400, statusMessage: '请求体不是合法 JSON' });
    }
}
