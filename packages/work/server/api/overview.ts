import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { briefs, notes, schedules } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { capBody } from '../utils/request-body';
import { shanghaiDateKey, shanghaiDayRange, shanghaiUpcomingEnd } from '../utils/work-day';

/** 今日页每块列表的条数上限：聚合接口一旦无界，一天打开几十次就是把整张表搬进浏览器。 */
const SLICE_MAX = 50;
/** 「未来 7 天」那块清单的天数；与 `work.statUpcomingDays` 之类文案同口径。 */
const UPCOMING_DAYS = 7;

/**
 * 今日总览：一次请求给出「今天要跑 / 今天已跑 / 未来 7 天 / 最近笔记 / 简报」五块。
 *
 * 刻意做成一个接口而不是让今日页发五个请求：这几块读的是同一时刻，
 * 分开取会出现「上半屏说还有 3 条要跑、下半屏的清单是空的」的错位。
 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);

    const now = new Date();
    const { start, end } = shanghaiDayRange(now);
    const weekEnd = shanghaiUpcomingEnd(end, UPCOMING_DAYS);
    const enabled = eq(schedules.enabled, true);
    const failedToday = and(eq(schedules.lastStatus, 'failed'), gte(schedules.lastRunAt, start), lt(schedules.lastRunAt, end));

    const [dueToday, runsToday, upcoming, scheduleCounts, noteCounts, recentNotes, brief] = await Promise.all([
        // 已经跑过的那一条同时也在 dueToday 里出现过是刻意的：页面上「今天要跑」讲的是安排，
        // 「今天已跑」讲的是结果，用户上午 11 点打开时要能看出 09:00 那条跑过且结果如何。
        db
            .select({
                id: schedules.id,
                title: schedules.title,
                kind: schedules.kind,
                timeText: schedules.timeText,
                nextRunAt: schedules.nextRunAt,
            })
            .from(schedules)
            .where(and(enabled, gte(schedules.nextRunAt, start), lt(schedules.nextRunAt, end)))
            .orderBy(asc(schedules.nextRunAt))
            .limit(SLICE_MAX),
        // `running` 也在这一块：认领的那一刻 `nextRunAt` 已经被推进到下一次（明天 09:00），
        // 于是「今天要跑」里没有它、`lastStatus` 又不是 success/failed 的话「今天已跑」里也没有它——
        // 正在执行的那一轮在页面上完全隐形，用户只能对着一个空清单等。
        db
            .select({
                id: schedules.id,
                title: schedules.title,
                agentId: schedules.agentId,
                lastRunAt: schedules.lastRunAt,
                lastStatus: schedules.lastStatus,
                lastError: schedules.lastError,
                lastConversationId: schedules.lastConversationId,
            })
            .from(schedules)
            .where(and(gte(schedules.lastRunAt, start), lt(schedules.lastRunAt, end), inArray(schedules.lastStatus, ['running', 'success', 'failed'] as const)))
            .orderBy(desc(schedules.lastRunAt))
            .limit(SLICE_MAX),
        db
            .select({ id: schedules.id, title: schedules.title, nextRunAt: schedules.nextRunAt })
            .from(schedules)
            .where(and(enabled, gte(schedules.nextRunAt, end), lt(schedules.nextRunAt, weekEnd)))
            .orderBy(asc(schedules.nextRunAt))
            .limit(SLICE_MAX),
        // 一次条件聚合出排期表的三个数，比发 3 个 count 少 2 次往返。
        // 时间条件必须是 drizzle 的条件对象而不是把 Date 直接塞进 `sql` 模板：
        // postgres-js 的裸参数编码器只吃 string/Buffer，传 Date 会在 `Buffer.from(date)` 上抛错。
        db
            .select({
                enabled: sql<number>`count(*) filter (where ${schedules.enabled})::int`,
                paused: sql<number>`count(*) filter (where not ${schedules.enabled})::int`,
                failedToday: sql<number>`count(*) filter (where ${failedToday})::int`,
            })
            .from(schedules),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(notes)
            .where(and(gte(notes.createdAt, start), lt(notes.createdAt, end))),
        db
            .select({
                id: notes.id,
                title: notes.title,
                kind: notes.kind,
                pinned: notes.pinned,
                tags: notes.tags,
                updatedAt: notes.updatedAt,
                excerpt: sql<string>`left(${notes.content}, 160)`,
            })
            .from(notes)
            .orderBy(desc(notes.pinned), desc(notes.updatedAt))
            .limit(SLICE_MAX),
        // 只要展示用的四列：`data` 是整份结构化快照（jsonb），今日页一天打开几十次，
        // 每次把没人读的快照搬回浏览器纯属浪费（它只用于「正文丢了按事实重建」）
        db
            .select({ briefDate: briefs.briefDate, content: briefs.content, model: briefs.model, generatedAt: briefs.generatedAt })
            .from(briefs)
            .where(eq(briefs.briefDate, shanghaiDateKey(now))),
    ]);

    const stat = scheduleCounts[0] ?? { enabled: 0, paused: 0, failedToday: 0 };

    return {
        date: shanghaiDateKey(now),
        dueToday,
        runsToday,
        upcoming,
        counts: {
            enabled: Number(stat.enabled),
            paused: Number(stat.paused),
            failedToday: Number(stat.failedToday),
            notesToday: Number(noteCounts[0]?.count ?? 0),
        },
        recentNotes,
        // 今天的简报还没生成时返回 null，界面据此显示「生成简报」而不是空白正文
        brief: brief[0] ?? null,
    };
});
