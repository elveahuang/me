import { eq } from 'drizzle-orm';
import { tools } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    // 0 行影响也要报出来：否则 id 抄错或行已被另一个管理员删掉时，界面照样提示「已删除」
    const deleted = await db.delete(tools).where(eq(tools.id, id)).returning({ id: tools.id });
    if (!deleted.length) throw createError({ statusCode: 404, statusMessage: '工具不存在' });
    return { ok: true };
});
