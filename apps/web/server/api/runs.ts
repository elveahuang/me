import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { agents, automationRuns, schedules, spaces } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { intParam, stringParam } from '../utils/query';
import { capBody } from '../utils/request-body';
import { resolveSpaceId } from '../utils/spaces';

const STATUSES = ['running', 'success', 'failed'] as const;

/** 运行中心列表：每一轮自动化执行的独立记录。 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);
    const query = getQuery(event);
    const where: SQL[] = [];

    const status = stringParam(query.status);
    if (status) {
        if (!(STATUSES as readonly string[]).includes(status))
            throw createError({ statusCode: 400, statusMessage: 'status 只能是 running / success / failed' });
        where.push(eq(automationRuns.status, status as (typeof STATUSES)[number]));
    }

    const scheduleId = stringParam(query.scheduleId);
    if (scheduleId) where.push(eq(automationRuns.scheduleId, scheduleId));

    const spaceId = stringParam(query.spaceId);
    if (spaceId) where.push(eq(schedules.spaceId, await resolveSpaceId(spaceId)));

    const page = intParam(query.page, 1, 1, 1e6);
    const pageSize = intParam(query.pageSize, 30, 1, 100);

    const [rows, [totalRow]] = await Promise.all([
        db
            .select({
                id: automationRuns.id,
                scheduleId: automationRuns.scheduleId,
                scheduleTitle: schedules.title,
                spaceId: schedules.spaceId,
                spaceName: spaces.name,
                agentId: schedules.agentId,
                agentName: agents.name,
                agentEmoji: agents.emoji,
                status: automationRuns.status,
                trigger: automationRuns.trigger,
                scheduledFor: automationRuns.scheduledFor,
                startedAt: automationRuns.startedAt,
                finishedAt: automationRuns.finishedAt,
                durationMs: automationRuns.durationMs,
                prompt: sql<string>`left(${automationRuns.prompt}, 240)`,
                outputConversationId: automationRuns.outputConversationId,
                error: sql<string>`left(${automationRuns.error}, 500)`,
            })
            .from(automationRuns)
            .innerJoin(schedules, eq(schedules.id, automationRuns.scheduleId))
            .leftJoin(agents, eq(agents.id, schedules.agentId))
            .leftJoin(spaces, eq(spaces.id, schedules.spaceId))
            .where(where.length ? and(...where) : undefined)
            .orderBy(desc(automationRuns.startedAt))
            .limit(pageSize)
            .offset((page - 1) * pageSize),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(automationRuns)
            .innerJoin(schedules, eq(schedules.id, automationRuns.scheduleId))
            .where(where.length ? and(...where) : undefined),
    ]);

    const total = Number(totalRow?.count ?? 0);
    return { runs: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
});
