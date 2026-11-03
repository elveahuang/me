/**
 * work 的错误码是**稳定契约**，中文 `statusMessage` 只是给人看的。
 *
 * 客户端（尤其命令面板和自动化页）不该靠中文文案判断错误类型；这里把 HTTP 状态收敛成
 * 一组有限码，`server/error.ts`（Nitro errorHandler）会把它们写进响应的 `data.code` 与
 * `x-work-error-code`。注意不要改回 `error` hook：Nitro 并行调用且不 await，序列化会抢跑。
 */
export const WORK_ERROR_CODES = {
    VALIDATION_FAILED: 'validation_failed',
    FORBIDDEN: 'forbidden',
    NOT_FOUND: 'not_found',
    METHOD_NOT_ALLOWED: 'method_not_allowed',
    CONFLICT: 'conflict',
    PAYLOAD_TOO_LARGE: 'payload_too_large',
    RATE_LIMITED: 'rate_limited',
    INTERNAL: 'internal_error',
    UPSTREAM_FAILED: 'upstream_failed',
} as const;

export type WorkErrorCode = (typeof WORK_ERROR_CODES)[keyof typeof WORK_ERROR_CODES];

/** 状态码 → 稳定错误码；未知 4xx 仍归 validation_failed，未知 5xx 归 internal_error。 */
export function workErrorCode(statusCode: number): WorkErrorCode {
    if (statusCode === 400 || statusCode === 422) return WORK_ERROR_CODES.VALIDATION_FAILED;
    if (statusCode === 401 || statusCode === 403) return WORK_ERROR_CODES.FORBIDDEN;
    if (statusCode === 404) return WORK_ERROR_CODES.NOT_FOUND;
    if (statusCode === 405) return WORK_ERROR_CODES.METHOD_NOT_ALLOWED;
    if (statusCode === 409) return WORK_ERROR_CODES.CONFLICT;
    if (statusCode === 413) return WORK_ERROR_CODES.PAYLOAD_TOO_LARGE;
    if (statusCode === 429) return WORK_ERROR_CODES.RATE_LIMITED;
    if (statusCode === 502 || statusCode === 503 || statusCode === 504) return WORK_ERROR_CODES.UPSTREAM_FAILED;
    if (statusCode >= 400 && statusCode < 500) return WORK_ERROR_CODES.VALIDATION_FAILED;
    return WORK_ERROR_CODES.INTERNAL;
}
