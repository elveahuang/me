import { eq } from 'drizzle-orm';
import { events } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { capBody } from '../../utils/request-body';
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
    const id = getRouterParam(event, 'id')!;

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
    // 日历与简报里那条安排会显示成「负时长」
    if (body.startsAt !== undefined) {
        const startsAt = normalizeWorkDate(body.startsAt, 'startsAt');
        if (!startsAt) throw createError({ statusCode: 400, statusMessage: 'startsAt 不能为空' });
        patch.startsAt = startsAt;
        if (body.endsAt !== undefined) {
            patch.endsAt = normalizeWorkDateRange(body.endsAt, startsAt);
        } else {
            const [current] = await db.select({ endsAt: events.endsAt }).from(events).where(eq(events.id, id));
            const endsAt = current?.endsAt ?? null;
            if (endsAt && endsAt.getTime() < startsAt.getTime()) throw createError({ statusCode: 400, statusMessage: 'endsAt 不能早于新的 startsAt' });
        }
    } else if (body.endsAt !== undefined) {
        const [current] = await db.select({ startsAt: events.startsAt }).from(events).where(eq(events.id, id));
        patch.endsAt = normalizeWorkDateRange(body.endsAt, current?.startsAt ?? new Date(0));
    }

    const [row] = await db.transaction(async (tx) => {
        // 改挂项目时先在父行上取锁，再写子行：
        // 不加锁时并发的 DELETE /api/projects/:id 能在「项目存在」检查与本次 UPDATE 之间提交，
        // 外键约束（set null）会把这条 PATCH 打成 23503 → 500 并把 SQL 细节透出响应体。
        if (body.projectId !== undefined) await lockProjectRow(tx, patch.projectId as string | null);
        return tx.update(events).set(patch).where(eq(events.id, id)).returning();
    });
    if (!row) throw createError({ statusCode: 404, statusMessage: '日程不存在' });
    return row;
});
