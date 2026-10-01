import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from '../../db/schema';
import { createOrder } from '../../utils/billing';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';
import { getPaymentProvider, resolvePaymentProviderCode } from '../../utils/payments';
import { rateLimit } from '../../utils/rate-limit';
import { readCappedJsonBody } from '../../utils/request-body';
import { getWechatOpenid } from '../../utils/wechat';

const CreateOrderSchema = z.object({
    planId: z.string().min(1),
    period: z.enum(['monthly', 'yearly']),
    provider: z.string().max(20).optional(),
});

/** 创建支付订单 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);

    // 限流：每用户每分钟最多 10 次下单
    const limited = await rateLimit(`orders:${session.user.id}`, 10, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }

    const body = (await readCappedJsonBody<Record<string, unknown>>(event)) ?? {};
    const parsed = CreateOrderSchema.safeParse(body);
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: `参数错误: ${parsed.error.issues[0]?.message ?? ''}` });
    }
    const { planId, period } = parsed.data;

    // 渠道选择（auto = 微信优先，其次可用渠道）
    const providerCode = resolvePaymentProviderCode(parsed.data.provider ?? 'auto');
    if (!providerCode) {
        throw createError({ statusCode: 400, statusMessage: '当前没有可用的支付渠道，请联系管理员配置微信支付' });
    }
    const paymentProvider = getPaymentProvider(providerCode);

    const { order } = await createOrder({ userId: session.user.id, planId, period, provider: providerCode });
    const openid = await getWechatOpenid(session.user.id);
    const reqHeaders = getRequestHeaders(event);
    let payment: Awaited<ReturnType<typeof paymentProvider.createPayment>>;
    try {
        payment = await paymentProvider.createPayment({
            orderNo: order.orderNo,
            description: `会员订阅 ${order.planCode} ${period}`,
            amountCents: order.amountCents,
            userAgent: reqHeaders['user-agent'] ?? '',
            openid: openid ?? undefined,
            clientIp: reqHeaders['x-forwarded-for']?.split(',')[0]?.trim() ?? undefined,
        });
    } catch (error) {
        // 订单已落库而渠道侧没有这笔单：queryOrder 永远查不到，定时关单与轮询都无法收敛，
        // 留 pending 就是永久悬挂。此处用户拿不到任何支付凭证、无法付款，直接条件关单。
        await db
            .update(orders)
            .set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')));
        // 渠道错误原文可能含商户号/请求细节，只进服务端日志
        console.error('[billing] 支付渠道下单失败:', error);
        throw createError({ statusCode: 502, statusMessage: '支付渠道暂时不可用，请稍后重试' });
    }

    await db
        .update(orders)
        .set({
            payInfo: { mode: payment.mode, payUrl: payment.payUrl ?? null, jsapiParams: payment.jsapiParams ?? null },
            updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

    setResponseStatus(event, 201);
    return {
        orderNo: order.orderNo,
        status: order.status,
        provider: providerCode,
        mode: payment.mode,
        payUrl: payment.payUrl,
        jsapiParams: payment.jsapiParams,
        amountCents: order.amountCents,
        planCode: order.planCode,
        period,
    };
});
