import { and, eq } from 'drizzle-orm';
import { orders } from '../../../db/schema';
import { activateMembership, ORDER_TTL_MS } from '../../../utils/billing';
import { db } from '../../../utils/db';
import { requireUser } from '../../../utils/guard';
import { getPaymentProvider } from '../../../utils/payments';
import { rateLimit } from '../../../utils/rate-limit';

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
        // 这个分支会真打支付渠道（超时后还额外发一次关单请求）。下单侧有 10 次/分钟限流，
        // 查单原本一点预算都没有：客户端 2s 轮询已占 30 次/分钟，多开标签页或直接压接口
        // 就能拿签名请求轰渠道。超预算时跳过同步、回库里的最新状态即可——
        // 支付回调链路独立开通会员，不会因为少查一次而漏单。
        const canSync = await rateLimit(`order-sync:${order.orderNo}`, 45, 60_000);
        if (canSync.ok) {
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
