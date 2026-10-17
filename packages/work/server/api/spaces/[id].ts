import { eq, sql } from 'drizzle-orm';
import { conversations, DEFAULT_SPACE_ID, schedules, spaces } from '../../db/schema';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { capBody, readCappedJsonBody } from '../../utils/request-body';
import { routeId } from '../../utils/route-id';
import { normalizeSpaceInput } from '../../utils/spaces';

export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'PATCH', 'DELETE']);
    const id = routeId(event, 'id', '工作空间');
    const [row] = await db.select().from(spaces).where(eq(spaces.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '工作空间不存在' });

    if (method === 'GET') {
        const [[conv], [sched]] = await Promise.all([
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(conversations)
                .where(eq(conversations.spaceId, id)),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(schedules)
                .where(eq(schedules.spaceId, id)),
        ]);
        return { ...row, conversationCount: Number(conv?.count ?? 0), scheduleCount: Number(sched?.count ?? 0) };
    }

    if (method === 'PATCH') {
        const body = (await readCappedJsonBody<Record<string, unknown>>(event)) ?? {};
        const input = normalizeSpaceInput(body, {
            name: row.name,
            description: row.description,
            icon: row.icon,
            instructions: row.instructions,
        });
        const [updated] = await db
            .update(spaces)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(spaces.id, id))
            .returning();
        return updated;
    }

    if (id === DEFAULT_SPACE_ID) {
        throw createError({ statusCode: 400, statusMessage: '默认空间不能删除，可以改名或归档' });
    }

    const [[conv], [sched]] = await Promise.all([
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(conversations)
            .where(eq(conversations.spaceId, id)),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(schedules)
            .where(eq(schedules.spaceId, id)),
    ]);
    if (Number(conv?.count ?? 0) || Number(sched?.count ?? 0)) {
        throw createError({ statusCode: 409, statusMessage: '这个空间里还有会话或自动化，请先移走或归档空间' });
    }
    await db.delete(spaces).where(eq(spaces.id, id));
    return { ok: true };
});
