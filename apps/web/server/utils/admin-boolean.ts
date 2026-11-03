import { createError } from 'h3';

/**
 * 管理端布尔列写入前的统一归一（各资源共用，不要再在各 handler 里各写一份）。
 *
 * 直写 `Boolean(raw)` 是取反而不是校验：表单编码（`application/x-www-form-urlencoded`、multipart）
 * 与手工请求会把开关送成字符串，而 `Boolean('false') === Boolean('0') === Boolean([]) === true`。
 * 对 `enabled`/`pinned` 只是状态反了，对 `isDefault` 则是「清掉其它配置的默认位 + 把自己设为默认」，
 * 一次本意「取消默认」的点击会把存储/供应商配置整个换掉。
 */
export function normalizeAdminBoolean(raw: unknown, label: string, fallback: boolean): boolean {
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw !== 'boolean') throw createError({ statusCode: 400, statusMessage: `${label} 必须为布尔值` });
    return raw;
}
