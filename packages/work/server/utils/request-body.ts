import type { H3Event } from 'h3';

/**
 * 带硬上限地读取请求体原始字节，不做解码、不解析。
 *
 * h3 1.15 的 `readBody`/`readRawBody` 没有任何体积参数：它们先把整个请求体读进内存，再解析/返回。
 * 只按 `Content-Length` 预检等于把上限交给客户端自觉——`Transfer-Encoding: chunked`
 * 压根没有长度头，一条几百 MB 的请求就会被完整缓冲住（限流按**次数**算，
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

/** h3 在 `node.req` 上缓存原始请求体用的 symbol（`Symbol.for('h3RawBody')`，跨模块实例同键）。 */
const H3_RAW_BODY = Symbol.for('h3RawBody');

/**
 * 按字节封顶读完请求体。
 *
 * 两个必须一起记住的性质：
 * 1. `node.req` 是**一次性**的流。第二次 `for await` 不会报错，只会立刻结束并给出空 Buffer——
 *    于是 `capBody()` + `readCappedJsonBody()` 这种「先闸门、后取体」的写法会把请求体读成 undefined，
 *    表现是接口静默忽略入参（附件登记收不到 objectKey、chat 收不到 messages）而不是报错。
 *    所以读完必须写进 h3 自己的缓存位，后续任何一次读取都复用那段字节。
 * 2. 缓存位里已经有 Buffer 时（capBody 读过、或 h3 的 readBody 读过）直接返回：闸门已经在第一次
 *    读取时按当次上限执行过，重复读只会拿到空体。
 */
export async function readCappedBodyBytes(event: H3Event, maxBytes: number): Promise<Buffer> {
    const req = event.node.req;
    const cached = (req as unknown as Record<symbol, unknown>)[H3_RAW_BODY];
    if (Buffer.isBuffer(cached)) return cached;

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

    const bytes = Buffer.concat(chunks);
    (req as unknown as Record<symbol, Buffer>)[H3_RAW_BODY] = bytes;
    return bytes;
}

/**
 * 语义化别名：multipart 解析器只吃「已经全部读完的 Buffer」，所以真正的内存上界只能在读取阶段设。
 * 读到的字节就是写在 h3 缓存位里的那段，`readMultipartFormData`/`readBody` 随后会复用它，
 * 二进制正文因此保持逐字节一致（探针用真实 h3 1.15.11 解析器验证过）。
 *
 * 前提是 `event` 由 Node 请求构造（本项目 `tools/deploy/dockerfile` 跑的是 nitro node preset）：
 * h3 取 raw body 的优先级是 `event._requestBody → event.web.request.body → req[Symbol]`，
 * 只有在以 Web Request 构造事件的 preset 下前两项才非空，那种情况下缓存位会被忽略（闸门失效，但不会读错数据）。
 */
export async function readCappedBodyIntoH3Cache(event: H3Event, maxBytes: number): Promise<Buffer> {
    return readCappedBodyBytes(event, maxBytes);
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
 * 管理端请求体的**粗粒度**上限。
 * 它只负责把「无限缓冲」变成「有限缓冲」，不是各端点的业务上限：
 * 配置表单是 KB 级，1MB 已留出一个数量级余量；确需更大的端点（知识库文档正文 2MB）
 * 通过 `capBody(event, MAX_REQUEST_BYTES)` 显式放大，别去动这个公共值。
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

/**
 * 每个写接口开场都要调一次的体积闸门。
 *
 * webapp 里这件事是 `requireAdmin` 顺手做的（封顶只能放在鉴权之后，否则匿名请求反过来获得
 * 每条连接缓冲 1MB 的额度）。work 没有鉴权，所以闸门独立成这一处，并且一律前置。
 *
 * 只在请求确实声明了正文时才读：`content-length: 0` 与 GET 必须空转，否则「chunked 但一直
 * 不写完」的请求会把 handler 挂在一个根本没有数据的流上。读完写回 h3 的缓存位，
 * 下游那些裸 `readBody(event)` 拿到的就是这段已校验的字节，解析结果与不预读一致。
 */
export async function capBody(event: H3Event, maxBytes = DEFAULT_JSON_BODY_BYTES): Promise<void> {
    const headers = event.node.req.headers;
    const hasBody = headers['transfer-encoding'] !== undefined || Number(headers['content-length']) > 0;
    if (!hasBody) return;
    await readCappedBodyIntoH3Cache(event, maxBytes);
}
