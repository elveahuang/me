/**
 * 请求关联 id：工作台没有账号体系，排障时只能靠一条 id 把「浏览器看到的错误」与
 * 「服务端日志 / session_runs 台账」对上。
 *
 * 只接受形状可控的客户端 id（8–128 位字母数字与 `._-`），其余一律重新生成。
 * 原因不是安全边界，而是可观测性：允许任意字符串会让日志被换行/控制字符切碎。
 */

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

export function normalizeRequestId(value: string | undefined | null): string | null {
    if (!value) return null;
    return REQUEST_ID_PATTERN.test(value) ? value : null;
}

export function newRequestId(): string {
    return `req_${crypto.randomUUID()}`;
}

/** handlers 里读中间件写入的 id；没有中间件（脚本直调）时返回空串而不是抛错。 */
export function getRequestId(event: { context: unknown }): string {
    const context = event.context as { requestId?: unknown } | undefined;
    return typeof context?.requestId === 'string' ? context.requestId : '';
}
