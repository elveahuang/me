import { and, eq } from 'drizzle-orm';
import { orders } from '../../../../db/schema';
import { activateMembership } from '../../../../utils/billing';
import { db } from '../../../../utils/db';
import { requireUser } from '../../../../utils/guard';

/** 开发环境模拟支付：mock 渠道订单一键置为已支付并开通会员 */
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
    if (order.provider !== 'mock') {
        throw createError({ statusCode: 400, statusMessage: '仅模拟渠道订单支持 mock 支付' });
    }

    // 与 MockPayProvider.isConfigured() 保持同一判定：生产环境必须显式开启 MOCK_PAY_ENABLED
    if (process.env.NODE_ENV === 'production' && process.env.MOCK_PAY_ENABLED !== 'true') {
        throw createError({ statusCode: 403, statusMessage: '生产环境禁用模拟支付' });
    }

    const paid = await activateMembership(order.orderNo, `mock_${Date.now()}`);
    return { ok: true, status: paid.status };
});
