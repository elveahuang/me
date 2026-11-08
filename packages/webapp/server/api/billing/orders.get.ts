import type { BillingPeriod, OrderRecord, OrderStatus, OrdersResponse } from '@commons/contract';
import { desc, eq } from 'drizzle-orm';
import { orders } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';

/**
 * 我的订单列表（最近 50 条）。
 *
 * 显式按 contract 的 OrderRecord 挑选字段并做 Date → ISO 转换（线上形状本就是
 * JSON 序列化后的 ISO 串，这里只是把类型层面说谎的 Date 改成真话），返回值
 * satisfies OrdersResponse：服务端改字段忘了同步契约时编译期即报错。
 */
const toOrderRecord = (row: typeof orders.$inferSelect): OrderRecord => ({
    id: row.id,
    orderNo: row.orderNo,
    planId: row.planId,
    planCode: row.planCode,
    period: row.period as BillingPeriod,
    amountCents: row.amountCents,
    status: row.status as OrderStatus,
    provider: row.provider,
    providerTradeNo: row.providerTradeNo,
    payInfo: row.payInfo,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
});

export default defineEventHandler(async (event): Promise<OrdersResponse> => {
    const session = await requireUser(event);
    const list = await db.select().from(orders).where(eq(orders.userId, session.user.id)).orderBy(desc(orders.createdAt)).limit(50);
    return { orders: list.map(toOrderRecord) };
});
