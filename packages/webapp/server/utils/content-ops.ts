import { createError } from 'h3';

/**
 * 内容运营（宣传栏 / 通知）共享的入参规范化。
 * 这些 handler 过去各写一份 normalizeLink/parseDate，且实现存在安全与语义分歧，收敛到此处统一维护。
 */

/**
 * 跳转链接规范化：只接受站内相对路径或 http/https 绝对地址。
 * - 空值返回 ''（表示无跳转）。
 * - 以单个 `/` 开头视为站内路径；但 `//host` 与 `/\host` 是协议相对地址，
 *   浏览器会按当前协议解析到任意外部域，必须拒绝，否则等于放开外链白名单。
 * - 其余要求可被 URL 解析且协议为 http/https，屏蔽 javascript:、data: 等危险协议。
 */
export function normalizeLink(raw: unknown): string {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    if (value.startsWith('//') || value.startsWith('/\\')) {
        throw createError({ statusCode: 400, statusMessage: '跳转链接不支持协议相对地址' });
    }
    if (value.startsWith('/')) return value;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw createError({ statusCode: 400, statusMessage: '跳转链接必须是 http/https 地址或以 / 开头的站内路径' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw createError({ statusCode: 400, statusMessage: '跳转链接仅允许 http/https 协议' });
    }
    return value;
}

/**
 * 时间窗入参解析：空值返回 null（表示不设边界），非法格式返回 400。
 */
export function parseDateInput(raw: unknown): Date | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const date = new Date(String(raw));
    if (Number.isNaN(date.getTime())) {
        throw createError({ statusCode: 400, statusMessage: '时间格式不正确' });
    }
    return date;
}

/**
 * 排序值规范化：整数列收到小数会被 PostgreSQL 拒为 22P02、超界拒为 22003，
 * 两者都会把 SQL 细节透出到响应体。缺省回退到 fallback，其余取整并夹到安全区间。
 */
export function normalizeSortOrder(raw: unknown, fallback = 0): number {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.round(value), -1_000_000_000), 1_000_000_000);
}
