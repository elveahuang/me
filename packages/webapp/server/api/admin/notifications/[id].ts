import { eq } from 'drizzle-orm';
import { notifications } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

/** 删除通知（收件人与已读记录级联删除） */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    const [existing] = await db.select().from(notifications).where(eq(notifications.id, id));
    if (!existing) throw createError({ statusCode: 404, statusMessage: '通知不存在' });

    await db.delete(notifications).where(eq(notifications.id, id));
    return { ok: true };
});
