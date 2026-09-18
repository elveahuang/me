import { and, eq } from 'drizzle-orm';
import { orders } from '../../../db/schema';
import { activateMembership, ORDER_TTL_MS } from '../../../utils/billing';
import { db } from '../../../utils/db';
import { requireUser } from '../../../utils/guard';
import { getPaymentProvider } from '../../../utils/payments';

/** 订单状态查询（前端轮询用）；顺带同步渠道状态并关单超时订单 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const orderNo = getRouterParam(event, 'orderNo');
    if (!orderNo) {
        throw createError({ statusCode: 400, statusMessage: '缺少订单号' });
    }

    const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.orderNo, orderNo), eq(orders.userId, session.user.id)));
    if (!order) {
        throw createError({ statusCode: 404, statusMessage: '订单不存在' });
    }

    let status = order.status;
    if (status === 'pending') {
        const provider = getPaymentProvider(order.provider);
        const expired = Date.now() - new Date(order.createdAt).getTime() > ORDER_TTL_MS;
        const remote = await provider.queryOrder(order.orderNo);
        if (remote === 'SUCCESS') {
            const paid = await activateMembership(order.orderNo);
            status = paid.status;
        } else if (expired && (remote === 'NOTPAY' || remote === 'CLOSED')) {
            const closed = await provider.closeOrder(order.orderNo);
            if (closed) {
                // closeOrder 是异步网络调用，期间回调可能已把订单置为 paid；用 status='pending' 条件避免覆盖。
                const updated = await db
                    .update(orders)
                    .set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
                    .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
                    .returning({ status: orders.status });
                if (updated.length) {
                    status = 'closed';
                } else {
                    // 关单条件未命中：状态已被并发流程改变，返回数据库当前值而不是本地假设
                    const [current] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id));
                    status = current?.status ?? status;
                }
            }
        }
    }

    const payInfo = (order.payInfo ?? {}) as {
        mode?: string;
        payUrl?: string | null;
        jsapiParams?: Record<string, string> | null;
    };

    return {
        orderNo: order.orderNo,
        status,
        provider: order.provider,
        planCode: order.planCode,
        period: order.period,
        amountCents: order.amountCents,
        mode: payInfo.mode ?? null,
        payUrl: payInfo.payUrl ?? null,
        jsapiParams: payInfo.jsapiParams ?? null,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
    };
});
