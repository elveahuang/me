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

/** 一个绝对时刻按北京时间读出来的年月日时分与星期（0=周日 … 6=周六）。 */
export function shanghaiParts(at: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
    const shifted = new Date(at.getTime() + SHANGHAI_OFFSET_MIN * 60_000);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        weekday: shifted.getUTCDay(),
    };
}

/**
 * 「未来 N 天」窗口的右开边界。
 *
 * 传的是 `shanghaiDayRange().end`（明天 00:00），不是 `start`：三处调用（今日页、简报快照、
 * `work_today` 工具）的文案都写「未来 7 天」，而按 `start + 7 天` 算出来只有 6 天——
 * 那条「下周一下午」的安排会出现在页面标题的口径里却不在清单里，用户只能自己发现。
 * 边界集中在这里算，避免三个文件各写一份 `+ N * 24h` 然后各差一天。
 */
export function shanghaiUpcomingEnd(nextDayStart: Date, days: number): Date {
    return new Date(nextDayStart.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * 「北京时间的某年某月某日几点几分」→ 绝对时刻。
 *
 * `Date.UTC` 会把超出当月的 `day` 顺延（`day: 32` 变成下月 1 日），定时任务算「下一次 occurrence」
 * 正是靠这一点逐日往后数，不需要调用方自己处理跨月/跨年。
 */
export function fromShanghaiParts(year: number, month: number, day: number, hour: number, minute: number): Date {
    return new Date(Date.UTC(year, month - 1, day, hour, minute) - SHANGHAI_OFFSET_MIN * 60_000);
}
