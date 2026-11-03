import { send, setResponseHeader, setResponseHeaders, setResponseStatus, type H3Event } from 'h3';
import { WORK_ERROR_CODES, workErrorCode } from './utils/api-error';
import { getRequestId } from './utils/request-id';

interface NitroDefaultResult {
    status: number;
    statusText: string;
    headers?: Record<string, string>;
    body: unknown;
}

/**
 * Nitro 级错误处理器：**同步**把 `data.code` / `data.requestId` 补进错误对象，再交给默认处理器。
 *
 * 为什么不能用 `error` hook：Nitro 的 `captureError` 是 `callHookParallel` 且不 await，
 * 默认处理器会在 hook 跑完之前就把响应序列化出去（实测 404 的 body 里没有 data）。
 * 错误处理器是唯一在序列化之前同步拿得到 `error` 与 `event` 的位置。
 *
 * 仍然复用 defaultHandler：API 得到 JSON，页面请求得到原来的 HTML 错误页，
 * 不为了加两个字段把非 API 的错误页改成 JSON。
 */
export default async function workErrorHandler(
    error: unknown,
    event: H3Event,
    options: { defaultHandler: (error: unknown, event: H3Event) => Promise<NitroDefaultResult> },
) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode) || 500;
    const previous = (error as { data?: unknown }).data;
    const data = previous && typeof previous === 'object' && !Array.isArray(previous) ? { ...(previous as Record<string, unknown>) } : {};
    const code = typeof data.code === 'string' ? data.code : workErrorCode(statusCode);
    const requestId = getRequestId(event);

    data.code = code;
    if (requestId) data.requestId = requestId;
    (error as { data?: unknown }).data = data;

    if (requestId) setResponseHeader(event, 'x-request-id', requestId);
    setResponseHeader(event, 'x-work-error-code', code);

    if (statusCode >= 500) {
        console.error(`[work-error] ${code}${requestId ? ` requestId=${requestId}` : ''}`, error);
    } else if (!(Object.values(WORK_ERROR_CODES) as string[]).includes(code)) {
        console.warn(`[work-error] 未归类的错误码 ${code}${requestId ? ` requestId=${requestId}` : ''}`);
    }

    const result = await options.defaultHandler(error, event);
    if (!event.node?.res.headersSent) {
        setResponseHeaders(event, result.headers ?? {});
    }
    setResponseStatus(event, result.status, result.statusText);
    return send(event, typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2));
}
