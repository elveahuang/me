import { badgeTone } from '@commons/contract';
import { dayInputValue } from './work-day';

/**
 * 工作台前端的类型与展示口径。
 *
 * 类型只描述 `/api/*` 回传的字段形状（服务端已有归一与封顶），前端不再校验一遍；
 * 展示相关的规则（状态档位、排期的一句话描述、日期相对说法）集中在这里，避免各页面各写一份映射。
 */

export type WorkNoteKind = 'note' | 'daily';
export type ScheduleKind = 'once' | 'interval' | 'daily' | 'weekly';
/** 空串是「这条排期还没跑过」，服务端用它而不是 null，好让 `lastError` 之类的伴生字段保持同形 */
export type ScheduleStatus = '' | 'running' | 'success' | 'failed';

export interface WorkNote {
    id: string;
    title: string;
    kind: WorkNoteKind;
    pinned: boolean;
    tags: string[];
    summary: string;
    content?: string;
    excerpt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface WorkSchedule {
    id: string;
    title: string;
    /** 列表只回前 240 字，完整正文走 `GET /api/schedules/{id}`（编辑表单才需要） */
    prompt: string;
    agentId: string;
    agentName: string;
    agentEmoji: string;
    kind: ScheduleKind;
    /** 'HH:mm'，按北京时间解释；interval 与 once 为空串 */
    timeText: string;
    intervalMinutes: number | null;
    /** weekly 的星期（0=周日 … 6=周六，按北京日），其余为空数组 */
    days: number[];
    startsAt: string;
    enabled: boolean;
    nextRunAt: string;
    lastRunAt: string | null;
    lastStatus: ScheduleStatus;
    lastError: string;
    lastConversationId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface WorkBrief {
    briefDate: string;
    content: string;
    model: string;
    generatedAt: string;
}

/** 今日页「今天要跑」只带清单要用的那几个字段，完整排期走 `/api/schedules`。 */
export interface WorkDueSchedule {
    id: string;
    title: string;
    kind: ScheduleKind;
    timeText: string;
    nextRunAt: string;
}

/** 今日页「今天已跑」的一行：跑完的结果，含失败原因与那条落成的会话。 */
export interface WorkScheduleRun {
    id: string;
    title: string;
    /** 打开那条形成的会话要按 `/chat/:agentId?c=` 深链，会话归属不能跨智能体续聊，所以必须带上它 */
    agentId: string;
    lastRunAt: string | null;
    lastStatus: ScheduleStatus;
    lastError: string;
    lastConversationId: string | null;
}

export interface WorkUpcomingSchedule {
    id: string;
    title: string;
    nextRunAt: string;
}

export interface WorkRecentNote {
    id: string;
    title: string;
    kind: WorkNoteKind;
    pinned: boolean;
    tags: string[];
    updatedAt: string;
    excerpt: string;
}

export interface WorkOverview {
    date: string;
    dueToday: WorkDueSchedule[];
    runsToday: WorkScheduleRun[];
    upcoming: WorkUpcomingSchedule[];
    counts: { enabled: number; paused: number; failedToday: number; notesToday: number };
    recentNotes: WorkRecentNote[];
    brief: WorkBrief | null;
}

/** 表单与筛选共用的排期类型顺序；顺序即下拉顺序，不要在页面里另排一次。 */
export const SCHEDULE_KIND_OPTIONS: ScheduleKind[] = ['daily', 'weekly', 'interval', 'once'];

/** 间隔步长的表单档位，与服务端 `work-schedule.ts` 的同名常量一致（改那里要一起改这里）。 */
export const INTERVAL_MINUTES_MIN = 5;
export const INTERVAL_MINUTES_MAX = 7 * 24 * 60;
export const INTERVAL_DEFAULT_MINUTES = 60;
/** 排期正文的字数上限，同样与服务端一致（超限是 400，界面先在提交前拦住）。 */
export const SCHEDULE_PROMPT_MAX = 4000;

export function scheduleStatusTone(status: ScheduleStatus): string {
    return badgeTone(status === 'success' ? 'success' : status === 'failed' ? 'danger' : status === 'running' ? 'info' : 'neutral');
}

type Translate = (key: string, named?: Record<string, unknown>) => string;

/**
 * 一句话描述这条排期什么时候跑，口径与服务端 `describeSchedule` 一致但走 locales。
 *
 * `timeText` 存的是「北京时间的几点」，不是绝对时刻，所以这里**不能**用 `formatDateTime`
 * 去解析它（那会按浏览器时区再偏一次）；直接原样打印就是用户填进去的那个钟点。
 */
export function scheduleSummary(
    row: Pick<WorkSchedule, 'kind' | 'timeText' | 'intervalMinutes' | 'days'>,
    t: Translate,
    weekdayName: (index: number) => string,
): string {
    switch (row.kind) {
        case 'interval':
            return t('work.scheduleEveryMinutes', { n: row.intervalMinutes ?? INTERVAL_DEFAULT_MINUTES });
        case 'weekly': {
            const days = (row.days ?? []).map(weekdayName).join('、');
            return `${t('work.scheduleWeekly')} ${days} ${row.timeText}`;
        }
        case 'once':
            return t('work.scheduleOnce');
        default:
            return `${t('work.scheduleDaily')} ${row.timeText}`;
    }
}

/**
 * 星期名的唯一来源。
 *
 * 用 `Intl.DateTimeFormat` 而不是在页面里写死「一二三」：语言切到 en 时英文表单要拿到 Mon，
 * 而 `days` 存的是数字索引，两侧都靠这个函数才不会各写一份表。
 */
export function makeWeekdayName(locale: string) {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    // 2026-01-04 是周日，索引 0 从它开始逐日往后
    return (index: number) => formatter.format(new Date(Date.UTC(2026, 0, 4 + index)));
}

/**
 * 表单的日期/钟点取值（`composeStartsAt`、`dayInputValue`、`todayInputValue`、`timeTextInputValue`）
 * 在 `work-day.ts`——那一组零依赖，冒烟测试才能把它与服务端 `server/utils/work-day.ts` 放进同一个对拍里。
 */

/** 相对日说法：今天/明天/昨天，其余交给 formatDate；跨年时补上年份。 */
export function relativeDayLabel(iso: string | null | undefined, today: string, t: Translate, formatDate: (value: string) => string): string {
    if (!iso) return '';
    const day = dayInputValue(iso);
    if (!day) return '';
    if (day === today) return t('work.dayToday');
    // 两侧都按 UTC 零点取时刻：按浏览器本地解析的话，跨夏令时那天会差一小时，整数比较全部失效
    const anchor = `${day}T00:00:00Z`;
    const todayAnchor = `${today}T00:00:00Z`;
    const offset = (Date.parse(anchor) - Date.parse(todayAnchor)) / 86_400_000;
    if (offset === 1) return t('work.dayTomorrow');
    if (offset === -1) return t('work.dayYesterday');
    if (offset > 1 && offset < 8) return t('work.inDays', { n: Math.round(offset) });
    if (offset < -1 && offset > -8) return t('work.daysAgo', { n: Math.round(-offset) });
    // 契约的 formatDate 按北京时区渲染，喂 UTC 零点正好落在这一个北京日的白天
    const formatted = formatDate(anchor);
    return day.slice(0, 4) === today.slice(0, 4) ? formatted.replace(/^[A-Za-z]+,? /, '') : formatted;
}
