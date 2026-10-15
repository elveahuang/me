import { eq } from 'drizzle-orm';
import { tasks } from '../../db/schema';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { capBody } from '../../utils/request-body';
import {
    WORK_DETAIL_MAX,
    WORK_TITLE_MAX,
    normalizeTaskPriority,
    normalizeTaskStatus,
    normalizeWorkDate,
    normalizeWorkOptionalText,
    normalizeWorkText,
    taskCompletionPatch,
} from '../../utils/work-input';
import { assertProjectExists, lockProjectRow } from '../../utils/work-project';

export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'PATCH', 'DELETE']);
    const id = getRouterParam(event, 'id')!;

    if (method === 'DELETE') {
        const deleted = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
        if (!deleted.length) throw createError({ statusCode: 404, statusMessage: '任务不存在' });
        return { ok: true };
    }

    if (method === 'GET') {
        const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
        if (!row) throw createError({ statusCode: 404, statusMessage: '任务不存在' });
        return row;
    }

    const body = (await readBody(event)) ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = normalizeWorkText(body.title, 'title', WORK_TITLE_MAX);
    if (body.detail !== undefined) patch.detail = normalizeWorkOptionalText(body.detail, 'detail', WORK_DETAIL_MAX);
    if (body.dueAt !== undefined) patch.dueAt = normalizeWorkDate(body.dueAt, 'dueAt');
    if (body.priority !== undefined) patch.priority = normalizeTaskPriority(body.priority);
    // projectId 显式传 null 是「移出项目」，传字符串则必须存在（否则外键会撞成 500）
    if (body.projectId !== undefined) patch.projectId = await assertProjectExists(body.projectId);

    // 状态与完成时间联动要先读旧行：只看 body.status 会把「已完成 → 重新打开」留成一个假完成时刻。
    // 读旧行与写入同事务并对行 FOR UPDATE，两个标签页同时改同一条时不会交错出错误状态。
    const [row] = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('update');
        if (!current) return [];
        if (body.status !== undefined) {
            patch.status = normalizeTaskStatus(body.status);
            Object.assign(patch, taskCompletionPatch(patch.status as string, current.completedAt));
        }
        // 挂项目要在同一事务里锁住父行，否则「校验通过后项目被删」会让这条 UPDATE 撞成 23503 → 500
        if (patch.projectId !== undefined) await lockProjectRow(tx, patch.projectId as string | null);
        return tx.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
    });
    if (!row) throw createError({ statusCode: 404, statusMessage: '任务不存在' });
    return row;
});
