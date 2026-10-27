import { createError } from 'h3';
import { SCHEDULE_KINDS, type ScheduleKind } from '../db/schema';
import { fromShanghaiParts, shanghaiDateKey, shanghaiParts } from './work-day';
import { normalizeWorkEnum } from './work-input';

/**
 * 定时任务的入参归一与「下一次时刻」计算。
 *
 * 全部是纯函数（只碰 Date 与 h3 的 createError），冒烟测试可以直接断言跨月、跨闰年、
 * 星期选择、interval 的锚点这些容易算错的形状——它们在真实接口上都要等下一分钟才看得出问题。
 *
 * 时区口径只有一个：`work-day.ts`。`timeText` / `days` 存的是「北京时间的几点、星期几」，
 * 计算全程按北京日数格子，再折成绝对时刻落库。runner 每分钟醒来比较的是绝对时刻，
 * 所以进程跑在 UTC 还是 +08 都不影响「每天 09:00」到底几点跑。
 */

/** 到点发给智能体的正文上限：再长就该拆成几步或让智能体自己取资料，而不是内嵌进排期。 */
export const SCHEDULE_PROMPT_MAX = 4_000;
/** 间隔的最小/最大步长：下限防止「每 1 分钟跑一次模型」把预算烧穿，上限让 interval 至少覆盖到一周。 */
export const INTERVAL_MINUTES_MIN = 5;
export const INTERVAL_MINUTES_MAX = 7 * 24 * 60;
export const INTERVAL_DEFAULT_MINUTES = 60;

/** 逐日/逐周往后数的上限：一年多一点，超过就当配置不可能命中，回 null 而不是死循环。 */
const OCCURRENCE_SCAN_MAX = 400;

/** `HH:mm`（北京时间）。只认这一种形状，界面上的 `<input type="time">` 给的正是它。 */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type SchedulePlan = {
    kind: ScheduleKind;
    timeText: string;
    intervalMinutes: number | null;
    days: number[];
    startsAt: Date;
};

function fail400(message: string): never {
    throw createError({ statusCode: 400, statusMessage: message });
}

export function normalizeScheduleKind(raw: unknown): ScheduleKind {
    return normalizeWorkEnum(raw, SCHEDULE_KINDS, 'kind', 'daily');
}

/**
 * 钟点归一。
 *
 * 不做「`9` 补成 `09:00`」这种宽容解析：界面给的是 `HH:mm`，模型给的可能是 `9:00`，
 * 静默补零会让用户在页面上看到「09:00」而库里存的是没被校验过的另一种写法，
 * 下一次 PATCH 又把它当成非法值。非空但不是 `HH:mm` 一律 400。
 */
export function normalizeScheduleTime(raw: unknown, label = 'time'): string {
    if (raw === undefined || raw === null || raw === '') return '';
    if (typeof raw !== 'string') fail400(`${label}必须是 HH:mm 字符串`);
    const value = raw.trim();
    if (!TIME_RE.test(value)) fail400(`${label}必须是 HH:mm（24 小时制）`);
    return value;
}

/**
 * 间隔步长（分钟）。
 *
 * 下限 5 分钟：runner 本身就是每分钟醒一次，比这更密的排期只会让上一轮没跑完就被下一轮排队，
 * 而每一次都是真实模型调用——「每分钟一次」就是一天 1440 次外呼。
 * 上限一周：再长就该排成 daily/weekly 用具体钟点，而不是「从现在起 10081 分钟」。
 */
export function normalizeScheduleInterval(raw: unknown): number {
    if (raw === undefined || raw === null || raw === '') return INTERVAL_DEFAULT_MINUTES;
    if (typeof raw !== 'number' || !Number.isInteger(raw)) fail400('intervalMinutes 必须是整数分钟');
    if (raw < INTERVAL_MINUTES_MIN || raw > INTERVAL_MINUTES_MAX) {
        fail400(`intervalMinutes 必须在 ${INTERVAL_MINUTES_MIN}–${INTERVAL_MINUTES_MAX} 之间`);
    }
    return raw;
}

/** 星期数组：0–6 取整去重排序；非法项只丢该项，整表为空由调用方按 kind 判定。 */
export function normalizeScheduleDays(raw: unknown): number[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) fail400('days 必须是 0–6 的数组');
    const seen = new Set<number>();
    for (const item of raw) {
        const value = typeof item === 'number' ? item : Number.NaN;
        if (Number.isInteger(value) && value >= 0 && value <= 6) seen.add(value);
    }
    return [...seen].sort((a, b) => a - b);
}

/**
 * 把五个字段收成一个可计算的 plan，并按 kind 补上各自的必填校验。
 *
 * 校验按 kind 分派而不是全都查：interval 没有钟点、daily 没有星期，
 * 一律要求会让界面上的表单要么留空要么提交失败，用户读到的 400 与他的填写无关。
 * `once` 的钟点已经在 `startsAt` 里（绝对时刻），所以它不要求 `timeText`。
 */
export function normalizeSchedulePlan(input: { kind: unknown; time: unknown; intervalMinutes: unknown; days: unknown; startsAt: Date }): SchedulePlan {
    const kind = normalizeScheduleKind(input.kind);
    const timeText = normalizeScheduleTime(input.time, 'time');
    const days = normalizeScheduleDays(input.days);

    if (kind === 'interval') {
        return { kind, timeText: '', intervalMinutes: normalizeScheduleInterval(input.intervalMinutes), days: [], startsAt: input.startsAt };
    }
    if (kind === 'weekly' && !days.length) fail400('weekly 至少要选一天');
    if (kind !== 'once' && !timeText) fail400(`${kind} 必须给出 time（HH:mm）`);
    return { kind, timeText, intervalMinutes: null, days, startsAt: input.startsAt };
}

function parseClock(timeText: string): { hour: number; minute: number } | null {
    const matched = TIME_RE.exec(timeText);
    if (!matched) return null;
    return { hour: Number(matched[1]), minute: Number(matched[2]) };
}

/**
 * 严格晚于 `after` 的下一次执行时刻；`null` = 这条 plan 不会再跑（once 已过期，或配置算不出候选）。
 *
 * daily/weekly 用「从 `max(after, startsAt)` 所在的北京日往后逐日数」而不是算毫秒差：
 * 北京日没有夏令时，但**跨月、跨年、2 月**靠 `Date.UTC` 的日溢出处理，
 * 自己减 24 小时会在「今天 23:30 排明天 09:00」这种边界上把日期算成后一天。
 */
export function computeNextRunAt(plan: SchedulePlan, after: Date): Date | null {
    if (plan.kind === 'once') return plan.startsAt.getTime() > after.getTime() ? plan.startsAt : null;

    if (plan.kind === 'interval') {
        const minutes = plan.intervalMinutes ?? INTERVAL_DEFAULT_MINUTES;
        const step = minutes * 60_000;
        if (after.getTime() < plan.startsAt.getTime()) return plan.startsAt;
        // 从锚点起算第 k 个整步，保证 09:00 锚点的每 60 分钟永远落在整点上，不会每轮漂移一分钟
        const steps = Math.floor((after.getTime() - plan.startsAt.getTime()) / step) + 1;
        const candidate = new Date(plan.startsAt.getTime() + steps * step);
        return candidate.getTime() > after.getTime() ? candidate : new Date(candidate.getTime() + step);
    }

    const clock = parseClock(plan.timeText);
    if (!clock) return null;
    const base = new Date(Math.max(after.getTime() + 1, plan.startsAt.getTime()));
    const day = shanghaiParts(base);
    for (let offset = 0; offset < OCCURRENCE_SCAN_MAX; offset++) {
        const candidate = fromShanghaiParts(day.year, day.month, day.day + offset, clock.hour, clock.minute);
        if (candidate.getTime() <= after.getTime()) continue;
        if (plan.kind === 'weekly' && !plan.days.includes(shanghaiParts(candidate).weekday)) continue;
        return candidate;
    }
    return null;
}

/** 页面与工具都要展示的一句话描述，口径与表单一致（不再在各处各拼一份中文）。 */
export function describeSchedule(plan: SchedulePlan): string {
    switch (plan.kind) {
        case 'once': {
            // once 的钟点只存在于 startsAt 这个绝对时刻里（表单不给 timeText），
            // 描述若只写「一次」，用户在读工具结果时无法知道是哪一天。
            const p = shanghaiParts(plan.startsAt);
            return `一次 ${shanghaiDateKey(plan.startsAt)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
        }
        case 'interval':
            return `每 ${plan.intervalMinutes ?? INTERVAL_DEFAULT_MINUTES} 分钟`;
        case 'daily':
            return `每天 ${plan.timeText}`;
        case 'weekly': {
            const names = ['日', '一', '二', '三', '四', '五', '六'];
            return `每周${plan.days.map((d) => names[d]).join('、')} ${plan.timeText}`;
        }
    }
}
