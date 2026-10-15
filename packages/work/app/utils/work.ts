import { badgeTone, dateInputToBoundary } from '@commons/contract';

/**
 * 工作台前端的类型与展示口径。
 *
 * 类型只描述 `/api/*` 回传的字段形状（服务端已有归一与封顶），前端不再校验一遍；
 * 展示相关的规则（状态档位、颜色、日期相对说法）集中在这里，避免各页面各写一份映射。
 */

export type WorkTaskStatus = 'todo' | 'doing' | 'done' | 'cancelled';
export type WorkTaskPriority = 'low' | 'medium' | 'high';
export type WorkNoteKind = 'note' | 'daily';
export type WorkSource = 'manual' | 'ai';

export interface WorkProject {
    id: string;
    name: string;
    description: string;
    color: string;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
    openTasks?: number;
    doneTasks?: number;
    noteCount?: number;
    eventCount?: number;
}

export interface WorkTask {
    id: string;
    projectId: string | null;
    title: string;
    detail: string;
    status: WorkTaskStatus;
    priority: WorkTaskPriority;
    dueAt: string | null;
    completedAt: string | null;
    source: WorkSource;
    createdAt: string;
    updatedAt: string;
}

export interface WorkNote {
    id: string;
    projectId: string | null;
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

export interface WorkEvent {
    id: string;
    projectId: string | null;
    title: string;
    detail: string;
    startsAt: string;
    endsAt: string | null;
    allDay: boolean;
    location: string;
    reminderAt: string | null;
    source: WorkSource;
    createdAt: string;
    updatedAt: string;
}

export interface WorkBrief {
    briefDate: string;
    content: string;
    model: string;
    generatedAt: string;
}

export interface WorkOverview {
    date: string;
    overdue: WorkTask[];
    dueToday: WorkTask[];
    upcomingEvents: WorkEvent[];
    counts: Record<string, number>;
    recentNotes: WorkNote[];
    activeProjects: Pick<WorkProject, 'id' | 'name' | 'color'>[];
    brief: WorkBrief | null;
}

/** 看板与筛选共用的状态顺序；顺序即列顺序，不要在页面里另排一次。 */
export const TASK_STATUSES: WorkTaskStatus[] = ['todo', 'doing', 'done', 'cancelled'];
export const TASK_PRIORITIES: WorkTaskPriority[] = ['high', 'medium', 'low'];

/** 状态 → 徽章档位：done 用 success、cancelled 用 neutral，逾期由调用方按日期另判。 */
export function statusTone(status: WorkTaskStatus): string {
    return badgeTone(status === 'done' ? 'success' : status === 'doing' ? 'info' : status === 'cancelled' ? 'neutral' : 'warning');
}

export function priorityTone(priority: WorkTaskPriority): string {
    return badgeTone(priority === 'high' ? 'danger' : priority === 'medium' ? 'warning' : 'neutral');
}

/** locales 里的状态/优先级键（用固定名而不是模板拼接，避免 `work.priorityhigh` 这类小写键） */
const STATUS_LABEL_KEY: Record<WorkTaskStatus, string> = {
    todo: 'work.statusTodo',
    doing: 'work.statusDoing',
    done: 'work.statusDone',
    cancelled: 'work.statusCancelled',
};
const PRIORITY_LABEL_KEY: Record<WorkTaskPriority, string> = { high: 'work.priorityHigh', medium: 'work.priorityMedium', low: 'work.priorityLow' };

type Translate = (key: string, named?: Record<string, unknown>) => string;

export function statusLabel(status: WorkTaskStatus, t: Translate): string {
    return t(STATUS_LABEL_KEY[status]);
}

export function priorityLabel(priority: WorkTaskPriority, t: Translate): string {
    return t(PRIORITY_LABEL_KEY[priority]);
}

/**
 * 时间输入框（`<input type="time">`）的取值按浏览器本地时区渲染。
 *
 * 这是刻意选择：工作台是**本机**应用，用户手上的时区就是他实际生活的时区，
 * 而到期时刻存的是绝对瞬间。数据库口径统一北京时间的事实由 `formatDateTime`
 * （契约里固定 Asia/Shanghai）负责展示，两侧不会互相冒充。
 */
export function timeInputValue(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 日期输入框取值（YYYY-MM-DD）；空值回退空串而不是 undefined，供 v-model 直接用。 */
export function dayInputValue(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 「日期 + 时间」两个输入框合成一个绝对时刻；日期为空则没有到期时间。
 *
 * 时间留空按 09:00 而不是 00:00：主流待办工具把「只选了日期」理解为「那天要做的白天事项」，
 * 取 00:00 会让它一早就变成「逾期」，用户看到一片红却不知道为什么。
 */
export function composeDueAt(day: string, time = ''): Date | null {
    const parsed = dateInputToBoundary(day, 'start');
    if (!parsed) return null;
    const matched = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!matched) return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 9, 0, 0, 0);
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), Number(matched[1]), Number(matched[2]), 0, 0);
}

/** 相对日说法：今天/明天/昨天，其余交给 formatDate；跨年时补上年份。 */
export function relativeDayLabel(
    iso: string | null | undefined,
    today: string,
    t: (key: string, named?: Record<string, unknown>) => string,
    formatDate: (value: string) => string,
): string {
    if (!iso) return '';
    const day = dayInputValue(iso);
    if (!day) return '';
    if (day === today) return t('work.dayToday');
    const offset = (Date.parse(`${day}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86_400_000;
    if (offset === 1) return t('work.dayTomorrow');
    if (offset === -1) return t('work.dayYesterday');
    if (offset > 1 && offset < 8) return t('work.inDays', { n: Math.round(offset) });
    if (offset < -1 && offset > -8) return t('work.daysAgo', { n: Math.round(-offset) });
    return day.slice(0, 4) === today.slice(0, 4) ? formatDate(`${day}T00:00:00`).replace(/^[A-Za-z]+,? /, '') : formatDate(`${day}T00:00:00`);
}

/** 把 `2026-10-16`（服务端的北京日 key）转成本地可比较的 YYYY-MM-DD 基准，避免时区差把「今天」算错。 */
export function todayInputValue(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 项目色点：`color` 是管理员/用户填的自由文本，只接受 6 位或 3 位十六进制，
 * 其它值（包括 `javascript:`、带引号的串）一律回退到主题的中性色，
 * 因为这里最终会变成内联 style 的一部分。
 */
export function safeProjectColor(color: string | null | undefined): string {
    const raw = (color ?? '').trim();
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw : 'var(--muted-2)';
}

/**
 * 某年某月的本地化月份标题（0 = 一月）。
 *
 * 用 `Date.UTC(y, m, 1)` + `timeZone: 'UTC'` 而不是 `new Date(y, m, 1).toLocaleString()`：
 * 后者读的是主机时区，虽然月标题几乎不会跨日，但这条展示口径与全站「日期展示固定时区」的
 * 约定同源，不要留一个随时区变的入口。
 */
export function monthLabel(year: number, month: number, locale = 'zh-CN'): string {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1)));
}
