import { eq } from 'drizzle-orm';
import { notifications } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

/**
 * 删除通知（收件人与已读记录级联删除）。
 *
 * 文件名带 `.delete` 而不是 `[id].ts` 内部判方法：这条路由此前对**任何**方法都执行删除，
 * 而 SameSite=Lax 的会话 cookie 会随顶层 GET 导航一起送出，一条带 id 的外链、一次预取或
 * 一次探活 `curl` 就能直接带走一条公告及其全部已读记录。交给 Nitro 限方法，
 * 就不存在「以后加一个分支又把闸门打开」的余地。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    const [existing] = await db.select().from(notifications).where(eq(notifications.id, id));
    if (!existing) throw createError({ statusCode: 404, statusMessage: '通知不存在' });

    await db.delete(notifications).where(eq(notifications.id, id));
    return { ok: true };
});
