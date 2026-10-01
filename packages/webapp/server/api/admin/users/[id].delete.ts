import { and, count, eq } from 'drizzle-orm';
import { orders } from '../../../db/schema';
import { assertUserId, removeAuthUser } from '../../../utils/admin-user-action';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const userId = assertUserId(getRouterParam(event, 'id'));

    // orders.user_id 与 user_memberships.user_id 都是 onDelete: 'cascade'：删用户会把已支付
    // 订单和会员开通记录一起带走，而管理端营收/对账口径就是从 orders 聚合的，事后只会表现为
    // 数字凭空变小。有已支付订单时拒绝删除，引导走封禁；只有未支付尝试的账号仍然可直接删。
    const [paid] = await db
        .select({ n: count() })
        .from(orders)
        .where(and(eq(orders.userId, userId), eq(orders.status, 'paid')));
    const paidCount = Number(paid?.n ?? 0);
    if (paidCount > 0) {
        throw createError({ statusCode: 409, statusMessage: `该用户有 ${paidCount} 笔已支付订单，删除会连带清除营收与会员记录，请改用封禁` });
    }

    await removeAuthUser(event.headers, userId);
    return { ok: true };
});
