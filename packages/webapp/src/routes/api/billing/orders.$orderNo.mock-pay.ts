import { db } from '@/db';
import { errorResponse, HttpError, json, requireUser } from '@/lib/api';
import { activateMembership } from '@/lib/billing';
import { corsMiddleware } from '@/lib/cors';
import { orders } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { and, eq } from 'drizzle-orm';

type RouteParams = { request: Request; params: { orderNo: string } };

/**
 * 开发环境模拟支付：mock 渠道订单一键置为已支付并开通会员。
 * 仅当订单 provider 为 mock 时可用；生产环境微信配置齐全后 mock 渠道不会被创建。
 */
export const Route = createFileRoute('/api/billing/orders/$orderNo/mock-pay')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            POST: async ({ request, params }: RouteParams) => {
                try {
                    const session = await requireUser(request);
                    const [order] = await db
                        .select()
                        .from(orders)
                        .where(and(eq(orders.orderNo, params.orderNo), eq(orders.userId, session.user.id)));
                    if (!order) throw new HttpError(404, '订单不存在');
                    if (order.provider !== 'mock') throw new HttpError(400, '仅模拟渠道订单支持 mock 支付');
                    // 生产环境安全闸门：微信支付已配置时 mock 渠道本就不该存在，防御性再拦一道
                    const wechatReady = Boolean(process.env.WECHAT_PAY_APP_ID && process.env.WECHAT_PAY_MCH_ID && process.env.WECHAT_PAY_API_KEY);
                    if (process.env.NODE_ENV === 'production' && wechatReady) throw new HttpError(403, '生产环境禁用模拟支付');

                    const paid = await activateMembership(order.orderNo, `mock_${Date.now()}`);
                    return json({ ok: true, status: paid.status });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
