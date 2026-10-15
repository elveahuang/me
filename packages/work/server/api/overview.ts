import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { briefs, events, notes, projects, tasks } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { capBody } from '../utils/request-body';
import { shanghaiDateKey, shanghaiDayRange } from '../utils/work-day';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Today 页每块列表的条数上限：聚合接口一旦无界，一天打开几十次就是把整张表搬进浏览器。 */
const SLICE_MAX = 50;

/**
 * 今日总览：一次请求给出「逾期 / 今天到期 / 即将到来 / 最近笔记 / 简报」五块。
 *
 * 刻意做成一个接口而不是让 Today 页发五个请求：这五块读的是同一时刻，
 * 分开取会出现「上半屏说还有 3 条逾期、下半屏的清单是空的」的错位。
 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);

    const now = new Date();
    const { start, end } = shanghaiDayRange(now);
    const weekEnd = new Date(start.getTime() + 7 * DAY_MS);
    const open = inArray(tasks.status, ['todo', 'doing'] as const);

    const [overdue, dueToday, upcomingEvents, statusCounts, recentNotes, activeProjects, brief] = await Promise.all([
        db
            .select()
            .from(tasks)
            .where(and(open, lt(tasks.dueAt, start)))
            .orderBy(asc(tasks.dueAt))
            .limit(SLICE_MAX),
        db
            .select()
            .from(tasks)
            .where(and(open, gte(tasks.dueAt, start), lt(tasks.dueAt, end)))
            .orderBy(asc(tasks.dueAt))
            .limit(SLICE_MAX),
        db
            .select()
            .from(events)
            .where(and(gte(events.startsAt, now), lt(events.startsAt, weekEnd)))
            .orderBy(asc(events.startsAt))
            .limit(SLICE_MAX),
        // 一次 GROUP BY 出全部状态计数，比按状态发 4 个 count 少 3 次往返
        db
            .select({ status: tasks.status, count: sql<number>`count(*)::int` })
            .from(tasks)
            .groupBy(tasks.status),
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
        db.select({ id: projects.id, name: projects.name, color: projects.color }).from(projects).where(eq(projects.archived, false)),
        db
            .select()
            .from(briefs)
            .where(eq(briefs.briefDate, shanghaiDateKey(now))),
    ]);

    const counts = { todo: 0, doing: 0, done: 0, cancelled: 0 } as Record<string, number>;
    for (const row of statusCounts) counts[row.status] = Number(row.count);

    return {
        date: shanghaiDateKey(now),
        overdue,
        dueToday,
        upcomingEvents,
        counts,
        recentNotes,
        activeProjects,
        // 今天的简报还没生成时返回 null，界面据此显示「生成简报」而不是空白正文
        brief: brief[0] ?? null,
    };
});
