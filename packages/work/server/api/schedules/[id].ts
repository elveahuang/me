import { eq } from 'drizzle-orm';
import { agents, schedules } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { capBody } from '../../utils/request-body';
import { routeId } from '../../utils/route-id';
import { assertScheduleAgent, resolvePlanOfRow } from '../../utils/schedule-store';
import { WORK_TITLE_MAX, normalizeWorkDate, normalizeWorkText } from '../../utils/work-input';
import { SCHEDULE_PROMPT_MAX } from '../../utils/work-schedule';

/** 这些字段任何一个变了都要重算 `nextRunAt`，否则改完钟点还得等下一轮才生效（或者永远不生效）。 */
const SCHEDULE_FIELDS = ['kind', 'time', 'intervalMinutes', 'days', 'startsAt'] as const;

export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'PATCH', 'DELETE']);
    const id = routeId(event, 'id', '定时任务');

    if (method === 'DELETE') {
        const deleted = await db.delete(schedules).where(eq(schedules.id, id)).returning({ id: schedules.id });
        if (!deleted.length) throw createError({ statusCode: 404, statusMessage: '定时任务不存在' });
        return { ok: true };
    }

    const columns = {
        id: schedules.id,
        title: schedules.title,
        prompt: schedules.prompt,
        agentId: schedules.agentId,
        agentName: agents.name,
        agentEmoji: agents.emoji,
        kind: schedules.kind,
        timeText: schedules.timeText,
        intervalMinutes: schedules.intervalMinutes,
        days: schedules.days,
        startsAt: schedules.startsAt,
        enabled: schedules.enabled,
        nextRunAt: schedules.nextRunAt,
        lastRunAt: schedules.lastRunAt,
        lastStatus: schedules.lastStatus,
        lastError: schedules.lastError,
        lastConversationId: schedules.lastConversationId,
        createdAt: schedules.createdAt,
        updatedAt: schedules.updatedAt,
    };

    if (method === 'GET') {
        const [row] = await db.select(columns).from(schedules).leftJoin(agents, eq(schedules.agentId, agents.id)).where(eq(schedules.id, id));
        if (!row) throw createError({ statusCode: 404, statusMessage: '定时任务不存在' });
        return row;
    }

    const body = (await readBody(event)) ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = normalizeWorkText(body.title, 'title', WORK_TITLE_MAX);
    if (body.prompt !== undefined) patch.prompt = normalizeWorkText(body.prompt, 'prompt', SCHEDULE_PROMPT_MAX);

    let startsAtValue: Date | undefined;
    if (body.startsAt !== undefined) {
        const parsed = normalizeWorkDate(body.startsAt, 'startsAt');
        if (!parsed) throw createError({ statusCode: 400, statusMessage: 'startsAt 不能为空' });
        startsAtValue = parsed;
        patch.startsAt = parsed;
    }

    const scheduleChanged = SCHEDULE_FIELDS.some((field) => body[field] !== undefined);

    // 读旧行与写入同事务并对行 FOR UPDATE：两个标签页同时改同一条排期时，
    // 合并出的 plan 与算出的 nextRunAt 才来自同一份旧值，不会一个改星期、一个改钟点互相覆盖。
    const updated = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(schedules).where(eq(schedules.id, id)).for('update');
        if (!current) return false;
        // `enabled` 与 `agentId` 也在锁内落定：前者要把「传了 null」当成「保持现状」，只有拿到旧行才有那个现值
        // （写成固定 `true` 的话，一次本想清空勾选的 PATCH 会变成「把已停用的任务重新启用并补跑一轮」）；
        // 后者需要在同一笔事务里对智能体行取 FOR SHARE，否则并发删除会把这条排期级联带走。
        if (body.enabled !== undefined) patch.enabled = normalizeAdminBoolean(body.enabled, 'enabled', current.enabled);
        if (body.agentId !== undefined) patch.agentId = await assertScheduleAgent(body.agentId, tx);
        // 停用→启用也要重算：停用的那几天里 `nextRunAt` 一直停在过去的时刻，不重算的话
        // 重新启用的下一分钟 runner 就会把它捡起来补跑一轮（用户以为只是「把开关打开」）。
        const turningOn = patch.enabled === true && !current.enabled;
        if (scheduleChanged || turningOn) {
            const { plan, nextRunAt } = resolvePlanOfRow(
                current,
                { kind: body.kind, time: body.time, intervalMinutes: body.intervalMinutes, days: body.days, startsAt: startsAtValue },
                new Date(),
            );
            Object.assign(patch, { kind: plan.kind, timeText: plan.timeText, intervalMinutes: plan.intervalMinutes, days: plan.days, nextRunAt });
        }
        await tx.update(schedules).set(patch).where(eq(schedules.id, id));
        return true;
    });
    if (!updated) throw createError({ statusCode: 404, statusMessage: '定时任务不存在' });

    const [row] = await db.select(columns).from(schedules).leftJoin(agents, eq(schedules.agentId, agents.id)).where(eq(schedules.id, id));
    // 与 POST 同一道闸门：事务提交后到这次回读之间行被级联带走时，不能回 200 空体（表单会以为改成功了）
    if (!row) throw createError({ statusCode: 409, statusMessage: '这条定时任务在保存后立刻被删掉了（它指向的智能体可能刚被删除），请重新保存' });
    return row;
});
