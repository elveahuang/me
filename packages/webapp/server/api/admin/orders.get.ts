import { desc, eq } from 'drizzle-orm';
import { orders, user } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

/** 管理端订单列表（最近 200 条） */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const list = await db
        .select({
            id: orders.id,
            orderNo: orders.orderNo,
            userEmail: user.email,
            planCode: orders.planCode,
            period: orders.period,
            amountCents: orders.amountCents,
            status: orders.status,
            provider: orders.provider,
            providerTradeNo: orders.providerTradeNo,
            paidAt: orders.paidAt,
            createdAt: orders.createdAt,
        })
        .from(orders)
        .leftJoin(user, eq(orders.userId, user.id))
        .orderBy(desc(orders.createdAt))
        .limit(200);

    return { orders: list };
});
