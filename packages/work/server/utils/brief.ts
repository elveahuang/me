import { generateText } from 'ai';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { agents, briefs, notes, schedules, type Brief } from '../db/schema';
import { db } from './db';
import { resolveModel } from './providers';
import { shanghaiDateInput, shanghaiDateKey, shanghaiDayRange, shanghaiUpcomingEnd } from './work-day';

/**
 * 每日简报：把「今天的工作台」压成一页可读的中文正文。
 *
 * 为什么要落库（`briefs` 主键就是日期）而不是每次打开今日页现生成：
 * 1. 生成一次就是一次真实外呼，今日页一天打开几十次，按打开次数算账会把预算花在重复内容上；
 * 2. 简报是「早上那一眼」的快照，重跑一遍会因为用户已经跑完了几条排期而改写历史，
 *    主键幂等 + `data` 里存结构化快照，正文丢了还能按同一份事实重建。
 *
 * 模型不可用（没配供应商 / 外呼失败）时不写库、直接抛可读错误，
 * 让定时任务与手动生成都能把原因讲清楚，而不是留下一份空正文把今天钉死。
 */

/** 简报正文上限：模型偶尔会写成长文，超过这个长度就截到最后一个整行，避免塞满提示词与界面。 */
const BRIEF_CONTENT_MAX = 6_000;
/** 进提示词的事实条数上限：今天排期/今天运行/未来安排各一块，再多就把生成变成了搬运。 */
const SNAPSHOT_ROWS_MAX = 20;
/** 一次生成的外层预算：供应商停摆时宁可让定时任务这轮失败，也不把请求挂到 undici 的 300 秒默认上限。 */
const GENERATE_TIMEOUT_MS = 60_000;

export type BriefSnapshot = {
    date: string;
    counts: { schedulesEnabled: number; ranToday: number; failedToday: number; notesToday: number };
    /** 今天排期表上要跑的（按 nextRunAt 落在北京日内筛） */
    dueToday: { id: string; title: string; nextRunAt: string; kind: string }[];
    /** 今天已经跑过的每一轮（含失败），失败的那条带原因 */
    runsToday: { id: string; title: string; lastRunAt: string; lastStatus: string; lastError: string }[];
    /** 未来 7 天里第一次要跑的安排，用来提醒「明天开始有排期」 */
    upcoming: { id: string; title: string; nextRunAt: string }[];
    recentNotes: { id: string; title: string; updatedAt: string }[];
};

function isoOrNull(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

/**
 * 采集某一天的事实快照。
 *
 * 区间按北京日切：与今日页的 `/api/overview` 同一个口径，
 * 否则「早上 8 点前生成的简报」会把昨天夜里那轮运行算成今天的。
 */
export async function collectBriefSnapshot(at: Date = new Date()): Promise<BriefSnapshot> {
    const { start, end } = shanghaiDayRange(at);
    // 「未来 7 天」= 从明天 00:00 起数 7 个北京日；按 start 数会只覆盖到第 6 天，
    // 而提示词与页面都写着 7（同一口径见 overview.ts 与 workbench-tools.ts 的 work_today）
    const weekEnd = shanghaiUpcomingEnd(end, 7);

    const [dueToday, runsToday, upcoming, enabledCount, notesToday, recentNotes] = await Promise.all([
        db
            .select({ id: schedules.id, title: schedules.title, nextRunAt: schedules.nextRunAt, kind: schedules.kind })
            .from(schedules)
            .where(and(eq(schedules.enabled, true), gte(schedules.nextRunAt, start), lt(schedules.nextRunAt, end)))
            .orderBy(asc(schedules.nextRunAt))
            .limit(SNAPSHOT_ROWS_MAX),
        db
            .select({
                id: schedules.id,
                title: schedules.title,
                lastRunAt: schedules.lastRunAt,
                lastStatus: schedules.lastStatus,
                lastError: schedules.lastError,
            })
            .from(schedules)
            .where(and(gte(schedules.lastRunAt, start), lt(schedules.lastRunAt, end), inArray(schedules.lastStatus, ['success', 'failed'] as const)))
            .orderBy(desc(schedules.lastRunAt))
            .limit(SNAPSHOT_ROWS_MAX),
        db
            .select({ id: schedules.id, title: schedules.title, nextRunAt: schedules.nextRunAt })
            .from(schedules)
            .where(and(eq(schedules.enabled, true), gte(schedules.nextRunAt, end), lt(schedules.nextRunAt, weekEnd)))
            .orderBy(asc(schedules.nextRunAt))
            .limit(SNAPSHOT_ROWS_MAX),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(schedules)
            .where(eq(schedules.enabled, true)),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(notes)
            .where(and(gte(notes.createdAt, start), lt(notes.createdAt, end))),
        db.select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt }).from(notes).orderBy(desc(notes.updatedAt)).limit(8),
    ]);

    const failedToday = runsToday.filter((row) => row.lastStatus === 'failed').length;

    return {
        date: shanghaiDateKey(at),
        counts: {
            schedulesEnabled: Number(enabledCount[0]?.count ?? 0),
            ranToday: runsToday.length,
            failedToday,
            notesToday: Number(notesToday[0]?.count ?? 0),
        },
        dueToday: dueToday.map((r) => ({ ...r, nextRunAt: r.nextRunAt.toISOString() })),
        runsToday: runsToday.map((r) => ({ ...r, lastRunAt: isoOrNull(r.lastRunAt) ?? '' })),
        upcoming: upcoming.map((r) => ({ ...r, nextRunAt: r.nextRunAt.toISOString() })),
        recentNotes: recentNotes.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
    };
}

/** 快照 → 提示词里的事实清单（模型不需要 JSON 的全部细节，只要读得懂的条目）。 */
function snapshotToPromptData(s: BriefSnapshot): string {
    /**
     * 空串与脏值都要挡：`lastRunAt` 在认领失败或行被手改时可能是空串，
     * 而 `new Date('')` 是 Invalid Date，`getUTCMinutes()` 回 NaN，
     * 于是「Na:Na」直接进了简报正文（模型照抄，用户看到的是简报里写着乱码时间）。
     */
    const at = (iso: string): Date | null => {
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? null : date;
    };
    const day = (iso: string) => {
        const date = at(iso);
        return date ? shanghaiDateKey(date) : '未知时间';
    };
    const clock = (iso: string) => {
        const date = at(iso);
        if (!date) return '--:--';
        const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
        return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
    };
    const due = s.dueToday.map((r) => `${r.title}（${clock(r.nextRunAt)}）`).join('、') || '无';
    const runs =
        s.runsToday
            .map((r) => `${r.title}（${clock(r.lastRunAt)} ${r.lastStatus === 'failed' ? `失败：${r.lastError || '未知原因'}` : '已跑出结果'}）`)
            .join('、') || '无';
    const upcoming = s.upcoming.map((r) => `${r.title}（${day(r.nextRunAt)} ${clock(r.nextRunAt)}）`).join('、') || '无';
    return [
        `日期：${s.date}（北京时间）`,
        `启用中的定时任务：${s.counts.schedulesEnabled} 条`,
        `今天要跑 ${s.dueToday.length}：${due}`,
        `今天已跑完 ${s.runsToday.length}（其中失败 ${s.counts.failedToday}）：${runs}`,
        `未来 7 天首次安排 ${s.upcoming.length}：${upcoming}`,
        `今天新增笔记：${s.counts.notesToday} 条`,
        `最近笔记：${s.recentNotes.map((r) => r.title || '无标题').join('、') || '无'}`,
    ].join('\n');
}

function buildBriefPrompt(s: BriefSnapshot): string {
    return [
        '你是本机工作台的每日简报撰写者。根据下面这份「今日事实清单」写一篇简体中文的每日简报。',
        '',
        '要求：',
        '- Markdown，总长不超过 400 字，分「今天要跑 / 运行与异常 / 后续安排 / 一句话建议」四小节，小节标题用 ###。',
        '- 只使用清单里给出的事实，不要编造任务、时间或笔记标题；清单里没有的小节写「无」。',
        '- 「运行与异常」里失败的那几条排在前面并把原因带上；没有失败就明确说没有。',
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
