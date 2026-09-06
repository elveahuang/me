import { db } from '@/db';
import { errorResponse, HttpError, json, readJson, requireUser } from '@/lib/api';
import { createOrder } from '@/lib/billing';
import { corsMiddleware } from '@/lib/cors';
import { getPaymentProvider } from '@/lib/payments';
import { rateLimit } from '@/lib/rate-limit';
import { getWechatOpenid } from '@/lib/wechat';
import { orders } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

type RouteParams = { request: Request };

const CreateOrderSchema = z.object({
    planId: z.number().int().positive(),
    period: z.enum(['monthly', 'yearly']),
    // 不传时由服务端决定：微信凭据已配置 → wechat，否则 mock（开发环境）
    provider: z.string().max(20).optional(),
});

/** 我的订单列表 / 创建支付订单 */
export const Route = createFileRoute('/api/billing/orders')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }: RouteParams) => {
                try {
                    const session = await requireUser(request);
                    const list = await db.select().from(orders).where(eq(orders.userId, session.user.id)).orderBy(desc(orders.id)).limit(50);
                    return json({ orders: list });
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request }: RouteParams) => {
                try {
                    const session = await requireUser(request);

                    // 限流：每用户每分钟最多 10 次下单，防刷 pending 订单
                    const limited = await rateLimit(`orders:${session.user.id}`, 10, 60_000);
                    if (!limited.ok) {
                        throw new HttpError(429, `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试`);
                    }

                    const parsed = CreateOrderSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const { planId, period } = parsed.data;

                    // 渠道选择：显式指定优先；否则微信已配置用微信，否则 mock
                    const provider = parsed.data.provider ?? 'auto';
                    const providerCode = provider === 'auto' ? (getPaymentProvider('wechat').isConfigured() ? 'wechat' : 'mock') : provider;
                    const paymentProvider = getPaymentProvider(providerCode);
                    if (!paymentProvider.isConfigured()) throw new HttpError(400, `支付渠道 ${providerCode} 未配置`);

                    const { order } = await createOrder({ userId: session.user.id, planId, period, provider: providerCode });
                    const openid = await getWechatOpenid(session.user.id);
                    const payment = await paymentProvider.createPayment({
                        orderNo: order.orderNo,
                        description: `会员订阅 ${order.planCode} ${period}`,
                        amountCents: order.amountCents,
                        userAgent: request.headers.get('user-agent') ?? '',
                        openid: openid ?? undefined,
                        // H5 支付必填；代理场景取第一个 IP（多级 x-forwarded-for 为逗号分隔）
                        clientIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
                    });

                    // 保存支付引导信息（含 JSAPI 拉起参数，页面刷新后仍可恢复），轮询/重渲染时无需重复下单
                    await db
                        .update(orders)
                        .set({
                            payInfo: { mode: payment.mode, payUrl: payment.payUrl ?? null, jsapiParams: payment.jsapiParams ?? null },
                            updatedAt: new Date(),
                        })
                        .where(eq(orders.id, order.id));

                    return json(
                        {
                            orderNo: order.orderNo,
                            status: order.status,
                            provider: providerCode,
                            mode: payment.mode,
                            payUrl: payment.payUrl,
                            jsapiParams: payment.jsapiParams,
                            amountCents: order.amountCents,
                            planCode: order.planCode,
                            period,
                        },
                        201,
                    );
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
