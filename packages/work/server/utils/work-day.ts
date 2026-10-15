/**
 * 「今天」的边界。
 *
 * 全站展示与计费口径都固定 Asia/Shanghai（契约的 formatDate、system-prompt 注入的北京时间），
 * 工作台若按主机时区切日，容器跑 UTC 时「今日到期」会和界面显示的日期差一天，
 * 也会和简报正文里的日期对不上。这里显式带上同一个时区。
 */
const SHANGHAI_OFFSET_MIN = 8 * 60;

/** 给定时刻所在「北京日」的 [当天 00:00, 次日 00:00)，用 UTC 毫秒表示。 */
export function shanghaiDayRange(at: Date = new Date()): { start: Date; end: Date } {
    const shifted = new Date(at.getTime() + SHANGHAI_OFFSET_MIN * 60_000);
    const dayStartUtcMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - SHANGHAI_OFFSET_MIN * 60_000;
    return { start: new Date(dayStartUtcMs), end: new Date(dayStartUtcMs + 24 * 60 * 60 * 1000) };
}

/** 把 YYYY-MM-DD（表单/查询串里的日期输入）按北京日解释成时刻；非法回退 null。 */
export function shanghaiDateInput(value: unknown, boundary: 'start' | 'end' = 'start'): Date | null {
    const raw = typeof value === 'string' ? value.trim() : '';
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!matched) return null;
    const [, y, m, d] = matched;
    const ms = Date.UTC(Number(y), Number(m) - 1, Number(d)) - SHANGHAI_OFFSET_MIN * 60_000;
    const date = new Date(boundary === 'end' ? ms + 24 * 60 * 60 * 1000 - 1 : ms);
    // Date.UTC 会把 2 月 30 日规范化成别的日期，回指校验才能识破「假日期」
    const back = new Date(date.getTime() + SHANGHAI_OFFSET_MIN * 60_000);
    const iso = `${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, '0')}-${String(back.getUTCDate()).padStart(2, '0')}`;
    return iso === raw ? date : null;
}

/** ISO 日期串（北京日口径），供按天 upsert 的简报使用。 */
export function shanghaiDateKey(at: Date = new Date()): string {
    const shifted = new Date(at.getTime() + SHANGHAI_OFFSET_MIN * 60_000);
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}
