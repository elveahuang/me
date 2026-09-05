import { db } from '@/db';
import { errorResponse, json, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { orders, user } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { desc, eq } from 'drizzle-orm';

type RouteParams = { request: Request };

/** 管理端订单列表（最近 200 条，含用户邮箱与套餐快照） */
export const Route = createFileRoute('/api/admin/orders')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }: RouteParams) => {
                try {
                    await requireAdmin(request);
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
                        .orderBy(desc(orders.id))
                        .limit(200);
                    return json({ orders: list });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
