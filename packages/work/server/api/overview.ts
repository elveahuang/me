import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { agents, automationRuns, conversations, schedules, spaces } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { stringParam } from '../utils/query';
import { capBody } from '../utils/request-body';
import { ensureDefaultSpace, resolveSpaceId } from '../utils/spaces';
import { shanghaiDateKey, shanghaiDayRange, shanghaiUpcomingEnd } from '../utils/work-day';

const SLICE_MAX = 20;

/** 今日工作台：一次请求给出同一时刻的待处理、计划、最近运行与最近会话。 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);
    await ensureDefaultSpace();

    const now = new Date();
    const { start, end } = shanghaiDayRange(now);
    const weekEnd = shanghaiUpcomingEnd(end, 7);
    const requestedSpaceId = stringParam(getQuery(event).spaceId);
    const spaceId = requestedSpaceId ? await resolveSpaceId(requestedSpaceId) : null;

    const [dueToday, upcoming, recentRuns, recentConversations, spaceRows, [enabledCount], [dueCount], [runningCount], [failedCount], [conversationCount]] =
        await Promise.all([
            db
                .select({
                    id: schedules.id,
                    title: schedules.title,
                    agentId: schedules.agentId,
                    agentName: agents.name,
                    agentEmoji: agents.emoji,
                    spaceId: schedules.spaceId,
                    spaceName: spaces.name,
                    nextRunAt: schedules.nextRunAt,
                    lastStatus: schedules.lastStatus,
                })
                .from(schedules)
                .leftJoin(agents, eq(agents.id, schedules.agentId))
                .leftJoin(spaces, eq(spaces.id, schedules.spaceId))
                .where(
                    and(
                        spaceId ? eq(schedules.spaceId, spaceId) : undefined,
                        eq(schedules.enabled, true),
                        gte(schedules.nextRunAt, start),
                        lt(schedules.nextRunAt, end),
                    ),
                )
                .orderBy(asc(schedules.nextRunAt))
                .limit(SLICE_MAX),
            db
                .select({
                    id: schedules.id,
                    title: schedules.title,
                    spaceName: spaces.name,
                    nextRunAt: schedules.nextRunAt,
                })
                .from(schedules)
                .leftJoin(spaces, eq(spaces.id, schedules.spaceId))
                .where(
                    and(
                        spaceId ? eq(schedules.spaceId, spaceId) : undefined,
                        eq(schedules.enabled, true),
                        gte(schedules.nextRunAt, end),
                        lt(schedules.nextRunAt, weekEnd),
                    ),
                )
                .orderBy(asc(schedules.nextRunAt))
                .limit(SLICE_MAX),
            db
                .select({
                    id: automationRuns.id,
                    scheduleId: automationRuns.scheduleId,
                    scheduleTitle: schedules.title,
                    spaceName: spaces.name,
                    agentEmoji: agents.emoji,
                    agentName: agents.name,
                    status: automationRuns.status,
                    startedAt: automationRuns.startedAt,
                    finishedAt: automationRuns.finishedAt,
                    durationMs: automationRuns.durationMs,
                    outputConversationId: automationRuns.outputConversationId,
                    error: sql<string>`left(${automationRuns.error}, 240)`,
                })
                .from(automationRuns)
                .innerJoin(schedules, eq(schedules.id, automationRuns.scheduleId))
                .leftJoin(agents, eq(agents.id, schedules.agentId))
                .leftJoin(spaces, eq(spaces.id, schedules.spaceId))
                .where(spaceId ? eq(schedules.spaceId, spaceId) : undefined)
                .orderBy(desc(automationRuns.startedAt))
                .limit(8),
            db
                .select({
                    id: conversations.id,
                    title: conversations.title,
                    agentId: conversations.agentId,
                    agentName: agents.name,
                    agentEmoji: agents.emoji,
                    spaceId: conversations.spaceId,
                    spaceName: spaces.name,
                    updatedAt: conversations.updatedAt,
                })
                .from(conversations)
                .innerJoin(agents, eq(agents.id, conversations.agentId))
                .leftJoin(spaces, eq(spaces.id, conversations.spaceId))
                .where(spaceId ? eq(conversations.spaceId, spaceId) : undefined)
                .orderBy(desc(conversations.updatedAt))
                .limit(8),
            db
                .select()
                .from(spaces)
                .where(and(eq(spaces.archived, false), spaceId ? eq(spaces.id, spaceId) : undefined))
                .orderBy(asc(spaces.createdAt)),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(schedules)
                .where(eq(schedules.enabled, true)),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(schedules)
                .where(
                    and(
                        spaceId ? eq(schedules.spaceId, spaceId) : undefined,
                        eq(schedules.enabled, true),
                        gte(schedules.nextRunAt, start),
                        lt(schedules.nextRunAt, end),
                    ),
                ),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(automationRuns)
                .where(eq(automationRuns.status, 'running')),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(automationRuns)
                .innerJoin(schedules, eq(schedules.id, automationRuns.scheduleId))
                .where(
                    and(
                        spaceId ? eq(schedules.spaceId, spaceId) : undefined,
                        eq(automationRuns.status, 'failed'),
                        gte(automationRuns.startedAt, start),
                        lt(automationRuns.startedAt, end),
                    ),
                ),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(conversations)
                .where(and(spaceId ? eq(conversations.spaceId, spaceId) : undefined, gte(conversations.updatedAt, start), lt(conversations.updatedAt, end))),
        ]);

    return {
        date: shanghaiDateKey(now),
        counts: {
            enabledSchedules: Number(enabledCount?.count ?? 0),
            dueToday: Number(dueCount?.count ?? 0),
            runningRuns: Number(runningCount?.count ?? 0),
            failedRunsToday: Number(failedCount?.count ?? 0),
            conversationsToday: Number(conversationCount?.count ?? 0),
        },
        dueToday,
        upcoming,
        recentRuns,
        recentConversations,
        spaces: spaceRows,
    };
});
