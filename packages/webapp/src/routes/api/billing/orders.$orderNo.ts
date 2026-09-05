import { db } from '@/db';
import { errorResponse, HttpError, json, requireUser } from '@/lib/api';
import { activateMembership, ORDER_TTL_MS } from '@/lib/billing';
import { corsMiddleware } from '@/lib/cors';
import { getPaymentProvider } from '@/lib/payments';
import { orders } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { and, eq } from 'drizzle-orm';

type RouteParams = { request: Request; params: { orderNo: string } };

/** 订单状态查询（前端轮询用）；顺带同步渠道状态并关单超时订单 */
export const Route = createFileRoute('/api/billing/orders/$orderNo')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request, params }: RouteParams) => {
                try {
                    const session = await requireUser(request);
                    const [order] = await db
                        .select()
                        .from(orders)
                        .where(and(eq(orders.orderNo, params.orderNo), eq(orders.userId, session.user.id)));
                    if (!order) throw new HttpError(404, '订单不存在');

                    let status = order.status;
                    if (status === 'pending') {
                        const provider = getPaymentProvider(order.provider);
                        // 主动查一次渠道（Native 扫码场景用户可能已支付而回调未达）
                        const remote = await provider.queryOrder(order.orderNo);
                        if (remote === 'SUCCESS') {
                            const paid = await activateMembership(order.orderNo);
                            status = paid.status;
                        } else if ((remote === 'NOTPAY' || remote === 'CLOSED') && Date.now() - new Date(order.createdAt).getTime() > ORDER_TTL_MS) {
                            // 仅在渠道明确未支付时才超时关单；查询失败（null/UNKNOWN）跳过，
                            // 避免用户已支付却被本地关单、回调到达后无法开通
                            await provider.closeOrder(order.orderNo);
                            await db.update(orders).set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, order.id));
                            status = 'closed';
                        }
                    }

                    const payInfo = (order.payInfo ?? {}) as { mode?: string; payUrl?: string | null };
                    return json({
                        orderNo: order.orderNo,
                        status,
                        provider: order.provider,
                        planCode: order.planCode,
                        period: order.period,
                        amountCents: order.amountCents,
                        mode: payInfo.mode ?? null,
                        payUrl: payInfo.payUrl ?? null,
                        paidAt: order.paidAt,
                        createdAt: order.createdAt,
                    });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
