import { json } from '@/lib/api';
import { activateMembership } from '@/lib/billing';
import { db } from '@/db';
import { WechatPayProvider } from '@/lib/payments/wechat';
import { orders } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';

type RouteParams = { request: Request };

/**
 * 微信支付回调通知（微信服务器调用，无登录态，靠平台签名验证）。
 * 必须返回微信约定的 JSON：成功 {code:'SUCCESS'}；失败返回 500 让微信重试。
 */
export const Route = createFileRoute('/api/pay/notify/wechat')({
    server: {
        handlers: {
            POST: async ({ request }: RouteParams) => {
                try {
                    const sdk = WechatPayProvider.shared().sdk;
                    if (!sdk) return json({ code: 'FAIL', message: '微信支付未配置' }, 500);

                    const body = await request.text();
                    const header = (name: string) => request.headers.get(name) ?? '';
                    const result = await sdk.webhook.verify({
                        headers: {
                            'wechatpay-signature': header('wechatpay-signature'),
                            'wechatpay-timestamp': header('wechatpay-timestamp'),
                            'wechatpay-nonce': header('wechatpay-nonce'),
                            'wechatpay-serial': header('wechatpay-serial'),
                        },
                        body,
                    });
                    if (!result.success) {
                        console.error('[wechat-pay] 回调验签失败:', JSON.stringify(result));
                        return json({ code: 'FAIL', message: '验签失败' }, 500);
                    }

                    if (result.eventType === 'TRANSACTION.SUCCESS') {
                        const data = result.decryptedData as
                            | { out_trade_no?: string; transaction_id?: string; amount?: { payer_total?: number } }
                            | undefined;
                        if (data?.out_trade_no) {
                            // 防御纵深：回调金额与订单不一致时拒绝开通
                            if (typeof data.amount?.payer_total === 'number') {
                                const [order] = await db.select({ amountCents: orders.amountCents }).from(orders).where(eq(orders.orderNo, data.out_trade_no));
                                if (order && order.amountCents !== data.amount.payer_total) {
                                    console.error('[wechat-pay] 回调金额不一致:', data.out_trade_no, data.amount.payer_total, '!=', order.amountCents);
                                    return json({ code: 'FAIL', message: '金额不一致' }, 500);
                                }
                            }
                            await activateMembership(data.out_trade_no, data.transaction_id);
                        }
                    }
                    // REFUND.* 事件：退款流程预留（当前订单模型只做订阅开通，退款走管理端人工）
                    return json({ code: 'SUCCESS', message: '成功' });
                } catch (e) {
                    console.error('[wechat-pay] 回调处理异常:', e);
                    return json({ code: 'FAIL', message: '处理失败' }, 500);
                }
            },
        },
    },
});
