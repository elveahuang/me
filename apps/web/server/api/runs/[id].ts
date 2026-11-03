import { eq } from 'drizzle-orm';
import { agents, automationRuns, schedules, spaces } from '../../db/schema';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { capBody } from '../../utils/request-body';
import { routeId } from '../../utils/route-id';

export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);
    const id = routeId(event, 'id', '运行记录');
    const [row] = await db
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
            prompt: automationRuns.prompt,
            outputConversationId: automationRuns.outputConversationId,
            error: automationRuns.error,
            attempt: automationRuns.attempt,
        })
        .from(automationRuns)
        .innerJoin(schedules, eq(schedules.id, automationRuns.scheduleId))
        .leftJoin(agents, eq(agents.id, schedules.agentId))
        .leftJoin(spaces, eq(spaces.id, schedules.spaceId))
        .where(eq(automationRuns.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '运行记录不存在' });
    return row;
});
