import { generateText } from 'ai';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { agents, briefs, events, notes, tasks, type Brief, type TaskStatus } from '../db/schema';
import { db } from './db';
import { resolveModel } from './providers';
import { shanghaiDateInput, shanghaiDateKey, shanghaiDayRange } from './work-day';

/**
 * 每日简报：把「今天的工作台」压成一页可读的中文正文。
 *
 * 为什么要落库（`briefs` 主键就是日期）而不是每次打开 Today 页现生成：
 * 1. 生成一次就是一次真实外呼，Today 页一天打开几十次，按打开次数算账会把预算花在重复内容上；
 * 2. 简报是「早上那一眼」的快照，重跑一遍会因为用户已经完成了几条任务而改写历史，
 *    主键幂等 + `data` 里存结构化快照，正文丢了还能按同一份事实重建。
 *
 * 模型不可用（没配供应商 / 外呼失败）时不写库、直接抛可读错误，
 * 让定时任务与手动生成都能把原因讲清楚，而不是留下一份空正文把今天钉死。
 */

/** 简报正文上限：模型偶尔会写成长文，超过这个长度就截到最后一个整行，避免塞满提示词与界面。 */
const BRIEF_CONTENT_MAX = 6_000;
/** 进提示词的事实条数上限：逾期/今天/日程各一块，再多就把生成变成了搬运。 */
const SNAPSHOT_ROWS_MAX = 20;
/** 一次生成的外层预算：供应商停摆时宁可让定时任务这轮失败，也不把请求挂到 undici 的 300 秒默认上限。 */
const GENERATE_TIMEOUT_MS = 60_000;

export type BriefSnapshot = {
    date: string;
    counts: Record<string, number>;
    overdue: { id: string; title: string; dueAt: string | null; priority: string }[];
    dueToday: { id: string; title: string; dueAt: string | null; priority: string; status: string }[];
    doneToday: { id: string; title: string }[];
    eventsToday: { id: string; title: string; startsAt: string; allDay: boolean; location: string }[];
    upcoming: { id: string; title: string; startsAt: string }[];
    recentNotes: { id: string; title: string; updatedAt: string }[];
};

function isoOrNull(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

/**
 * 采集某一天的事实快照。
 *
 * 区间按北京日切：与 Today 页的 `/api/overview`、`/api/events` 默认窗口同一个口径，
 * 否则「早上 8 点前生成的简报」会算进昨天下午到期的任务。
 */
export async function collectBriefSnapshot(at: Date = new Date()): Promise<BriefSnapshot> {
    const { start, end } = shanghaiDayRange(at);
    const open = inArray(tasks.status, ['todo', 'doing'] as TaskStatus[]);
    const weekEnd = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [overdue, dueToday, doneToday, todayEvents, upcoming, counts, recentNotes] = await Promise.all([
        db
            .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority })
            .from(tasks)
            .where(and(open, isNotNull(tasks.dueAt), lt(tasks.dueAt, start)))
            .orderBy(asc(tasks.dueAt))
            .limit(SNAPSHOT_ROWS_MAX),
        db
            .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority, status: tasks.status })
            .from(tasks)
            .where(and(open, gte(tasks.dueAt, start), lt(tasks.dueAt, end)))
            .orderBy(asc(tasks.dueAt))
            .limit(SNAPSHOT_ROWS_MAX),
        db
            .select({ id: tasks.id, title: tasks.title })
            .from(tasks)
            .where(and(eq(tasks.status, 'done'), gte(tasks.completedAt, start), lt(tasks.completedAt, end)))
            .orderBy(desc(tasks.completedAt))
            .limit(SNAPSHOT_ROWS_MAX),
        db
            .select({ id: events.id, title: events.title, startsAt: events.startsAt, allDay: events.allDay, location: events.location })
            .from(events)
            .where(and(gte(events.startsAt, start), lt(events.startsAt, end)))
            .orderBy(asc(events.startsAt))
            .limit(SNAPSHOT_ROWS_MAX),
        db
            .select({ id: events.id, title: events.title, startsAt: events.startsAt })
            .from(events)
            .where(and(gte(events.startsAt, end), lt(events.startsAt, weekEnd)))
            .orderBy(asc(events.startsAt))
            .limit(SNAPSHOT_ROWS_MAX),
        db
            .select({ status: tasks.status, count: sql<number>`count(*)::int` })
            .from(tasks)
            .groupBy(tasks.status),
        db.select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt }).from(notes).orderBy(desc(notes.updatedAt)).limit(8),
    ]);

    const stat = { todo: 0, doing: 0, done: 0, cancelled: 0 } as Record<string, number>;
    for (const row of counts) stat[row.status] = Number(row.count);

    return {
        date: shanghaiDateKey(at),
        counts: stat,
        overdue: overdue.map((r) => ({ ...r, dueAt: isoOrNull(r.dueAt) })),
        dueToday: dueToday.map((r) => ({ ...r, dueAt: isoOrNull(r.dueAt) })),
        doneToday,
        eventsToday: todayEvents.map((r) => ({ ...r, startsAt: r.startsAt.toISOString() })),
        upcoming: upcoming.map((r) => ({ ...r, startsAt: r.startsAt.toISOString() })),
        recentNotes: recentNotes.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
    };
}

/** 快照 → 提示词里的事实清单（模型不需要 JSON 的全部细节，只要读得懂的条目）。 */
function snapshotToPromptData(s: BriefSnapshot): string {
    const line = (prefix: string, rows: { title: string; dueAt?: string | null; startsAt?: string; priority?: string; location?: string }[]) =>
        `${prefix} ${rows.length}：${rows.map((r) => `${r.title}${r.dueAt ? `（${shanghaiDateKey(new Date(r.dueAt))}）` : ''}${r.startsAt ? `（${shanghaiDateKey(new Date(r.startsAt))} ${r.location ? `@${r.location}` : ''}）` : ''}`).join('、') || '无'}`;
    return [
        `日期：${s.date}（北京时间）`,
        `任务计数：待办 ${s.counts.todo} / 进行中 ${s.counts.doing} / 已完成 ${s.counts.done}`,
        line('已逾期未完', s.overdue),
        line('今天到期', s.dueToday),
        line(
            '今天已完成',
            s.doneToday.map((r) => ({ title: r.title })),
        ),
        line(
            '今天的日程',
            s.eventsToday.map((r) => ({ title: r.title, startsAt: r.startsAt, location: r.location })),
        ),
        line('未来 7 天日程', s.upcoming),
        `最近笔记：${s.recentNotes.map((r) => r.title || '无标题').join('、') || '无'}`,
    ].join('\n');
}

function buildBriefPrompt(s: BriefSnapshot): string {
    return [
        '你是本机工作台的每日简报撰写者。根据下面这份「今日事实清单」写一篇简体中文的每日简报。',
        '',
        '要求：',
        '- Markdown，总长不超过 400 字，分「今天要事 / 逾期与风险 / 日程 / 一句话建议」四小节，小节标题用 ###。',
        '- 只使用清单里给出的事实，不要编造任务、时间或项目；清单里没有的小节写「无」。',
        '- 逾期任务按优先级 high > medium > low 排在前面；没有逾期就明确说没有。',
        '- 不要重复整份清单，只挑出最需要用户今天注意的条目。',
        '',
        '今日事实清单：',
        snapshotToPromptData(s),
    ].join('\n');
}

function capContent(text: string): string {
    const trimmed = text.trim();
    if (trimmed.length <= BRIEF_CONTENT_MAX) return trimmed;
    const cut = trimmed.slice(0, BRIEF_CONTENT_MAX);
    const lastNewline = cut.lastIndexOf('\n');
    return (lastNewline > BRIEF_CONTENT_MAX / 2 ? cut.slice(0, lastNewline) : cut).trimEnd();
}

export interface GenerateBriefResult {
    brief: Brief;
    /** 本次是否真的调用了模型（当天已有简报且未 force 时直接复用，不产生外呼） */
    generated: boolean;
}

/**
 * 生成（或复用）某一天的简报并落库。
 *
 * 模型选择：优先用第一个启用的智能体的供应商与模型——工作台至少有一个智能体才能对话，
 * 而 `resolveModel()` 在什么都不传时会兜到 `deepseek-chat`，
 * 对非 DeepSeek 的兼容端点那就是一个不存在的模型名。
 */
export async function generateBrief(options: { at?: Date; force?: boolean } = {}): Promise<GenerateBriefResult> {
    const at = options.at ?? new Date();
    const briefDate = shanghaiDateKey(at);

    if (!options.force) {
        const [existing] = await db.select().from(briefs).where(eq(briefs.briefDate, briefDate));
        if (existing?.content) return { brief: existing, generated: false };
    }

    const snapshot = await collectBriefSnapshot(at);

    const [agent] = await db
        .select({ providerId: agents.providerId, model: agents.model })
        .from(agents)
        .where(eq(agents.enabled, true))
        .orderBy(asc(agents.createdAt))
        .limit(1);
    const { model, modelId } = await resolveModel(agent?.providerId, agent?.model);

    const { text } = await generateText({
        model,
        prompt: buildBriefPrompt(snapshot),
        timeout: GENERATE_TIMEOUT_MS,
        abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
    const content = capContent(text);
    if (!content) throw new Error('模型没有返回可用的简报正文');

    // 主键就是日期：重复触发靠 upsert 天然幂等，多实例各跑一次也只是重写同一天
    await db
        .insert(briefs)
        .values({ briefDate, content, data: snapshot, model: modelId, generatedAt: new Date() })
        .onConflictDoUpdate({ target: briefs.briefDate, set: { content, data: snapshot, model: modelId, generatedAt: new Date() } });

    const [row] = await db.select().from(briefs).where(eq(briefs.briefDate, briefDate));
    return { brief: row!, generated: true };
}

/**
 * 定时任务用的入口：只在「今天还没简报」时生成。
 * 返回 false 表示当天已有简报、本轮什么都不做（因此不会计入失败，也不会重复外呼）。
 */
export async function ensureTodayBrief(): Promise<{ ran: boolean; reason?: string }> {
    const briefDate = shanghaiDateKey(new Date());
    const [existing] = await db.select({ content: briefs.content }).from(briefs).where(eq(briefs.briefDate, briefDate));
    if (existing?.content) return { ran: false, reason: '当天简报已存在' };
    await generateBrief({ at: new Date() });
    return { ran: true };
}

/** `?date=2026-10-16`：非法或缺失时返回 null（= 今天），而不是让 Invalid Date 把查询打成 500。 */
export function briefDateInput(raw: unknown): Date | null {
    return shanghaiDateInput(raw, 'start');
}
