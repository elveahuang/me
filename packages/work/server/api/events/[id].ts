import { eq } from 'drizzle-orm';
import { events } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { capBody } from '../../utils/request-body';
import { routeId } from '../../utils/route-id';
import {
    EVENT_LOCATION_MAX,
    WORK_DETAIL_MAX,
    WORK_TITLE_MAX,
    normalizeWorkDate,
    normalizeWorkDateRange,
    normalizeWorkOptionalText,
    normalizeWorkText,
} from '../../utils/work-input';
import { assertProjectExists, lockProjectRow } from '../../utils/work-project';

export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'PATCH', 'DELETE']);
    const id = routeId(event, 'id', '日程');

    if (method === 'DELETE') {
        const deleted = await db.delete(events).where(eq(events.id, id)).returning({ id: events.id });
        if (!deleted.length) throw createError({ statusCode: 404, statusMessage: '日程不存在' });
        return { ok: true };
    }

    if (method === 'GET') {
        const [row] = await db.select().from(events).where(eq(events.id, id));
        if (!row) throw createError({ statusCode: 404, statusMessage: '日程不存在' });
        return row;
    }

    const body = (await readBody(event)) ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = normalizeWorkText(body.title, 'title', WORK_TITLE_MAX);
    if (body.detail !== undefined) patch.detail = normalizeWorkOptionalText(body.detail, 'detail', WORK_DETAIL_MAX);
    if (body.location !== undefined) patch.location = normalizeWorkOptionalText(body.location, 'location', EVENT_LOCATION_MAX);
    if (body.allDay !== undefined) patch.allDay = normalizeAdminBoolean(body.allDay, 'allDay', false);
    if (body.reminderAt !== undefined) patch.reminderAt = normalizeWorkDate(body.reminderAt, 'reminderAt');
    if (body.projectId !== undefined) patch.projectId = await assertProjectExists(body.projectId);

    // startsAt 与 endsAt 要成对校验：只改开始时间而不复核既有的结束时间，能把日程改成 endsAt < startsAt，
    // 日历与简报里那条安排会显示成「负时长」。
    // 但「读另一端的现值」必须和写发生在同一个事务里、且对目标行取锁，否则校验读的是快照：
    // 库里是 10:00–12:00 时，两个并发的 PATCH（一个把 startsAt 推到 11:00、一个把 endsAt 拉到 10:30）
    // 各自都对着对方的旧值通过校验，双双落库后这条日程就成了 endsAt < startsAt——
    // 而之后想手工修回去，无论单改哪一端都会撞 400，只能两端一起提交。
    // 行锁把「读现值 → 配对校验 → 写」串成一段：后到的那个要么读到已提交的新另一端从而被 400 挡住，
    // 要么排在前一个之后，配对关系始终成立。
    let startsAtValue: Date | undefined;
    let endsAtValue: Date | null | undefined;
    let crossCheckStartsAt = false;
    if (body.startsAt !== undefined) {
        const startsAt = normalizeWorkDate(body.startsAt, 'startsAt');
        if (!startsAt) throw createError({ statusCode: 400, statusMessage: 'startsAt 不能为空' });
        startsAtValue = startsAt;
        patch.startsAt = startsAt;
        if (body.endsAt !== undefined) {
            // 两端都在本次请求里：以请求自身为准立刻判形状，不必等读库
            endsAtValue = normalizeWorkDateRange(body.endsAt, startsAt);
            patch.endsAt = endsAtValue;
        } else {
            crossCheckStartsAt = true;
        }
    } else if (body.endsAt !== undefined) {
        endsAtValue = normalizeWorkDate(body.endsAt, 'endsAt');
        patch.endsAt = endsAtValue;
        crossCheckStartsAt = true;
    }

    const [row] = await db.transaction(async (tx) => {
        // 改挂项目时先在父行上取锁，再写子行：
        // 不加锁时并发的 DELETE /api/projects/:id 能在「项目存在」检查与本次 UPDATE 之间提交，
        // 外键约束（set null）会把这条 PATCH 打成 23503 → 500 并把 SQL 细节透出响应体。
        if (body.projectId !== undefined) await lockProjectRow(tx, patch.projectId as string | null);
        if (crossCheckStartsAt) {
            const [current] = await tx.select({ startsAt: events.startsAt, endsAt: events.endsAt }).from(events).where(eq(events.id, id)).for('update');
            if (current) {
                const startsAt = startsAtValue ?? current.startsAt;
                const endsAt = endsAtValue === undefined ? current.endsAt : endsAtValue;
                if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
                    throw createError({
                        statusCode: 400,
                        statusMessage: startsAtValue ? 'endsAt 不能早于新的 startsAt' : 'endsAt 不能早于 startsAt',
                    });
                }
            }
        }
        return tx.update(events).set(patch).where(eq(events.id, id)).returning();
    });
    if (!row) throw createError({ statusCode: 404, statusMessage: '日程不存在' });
    return row;
});
