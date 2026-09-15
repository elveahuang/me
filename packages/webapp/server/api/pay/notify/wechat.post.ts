import { eq } from 'drizzle-orm';
import { orders } from '../../../db/schema';
import { activateMembership } from '../../../utils/billing';
import { db } from '../../../utils/db';
import { WechatPayProvider } from '../../../utils/payments/wechat';

/**
 * 微信支付回调通知（微信服务器调用，无登录态，靠平台签名验证）。
 * 必须返回微信约定的 JSON：成功 {code:'SUCCESS'}；失败返回 500 让微信重试。
 */
export default defineEventHandler(async (event) => {
    try {
        const sdk = WechatPayProvider.shared().sdk;
        if (!sdk) {
            setResponseStatus(event, 500);
            return { code: 'FAIL', message: '微信支付未配置' };
        }

        const body = (await readRawBody(event, 'utf8')) ?? '';
        const headers = getRequestHeaders(event);
        const header = (name: string) => headers[name] ?? '';

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
            setResponseStatus(event, 500);
            return { code: 'FAIL', message: '验签失败' };
        }

        if (result.eventType === 'TRANSACTION.SUCCESS') {
            const data = result.decryptedData as
                { out_trade_no?: string; transaction_id?: string; amount?: { total?: number; payer_total?: number } } | undefined;
            if (data?.out_trade_no) {
                if (typeof data.amount?.total === 'number') {
                    const [order] = await db.select({ amountCents: orders.amountCents }).from(orders).where(eq(orders.orderNo, data.out_trade_no));
                    if (order && order.amountCents !== data.amount.total) {
                        console.error('[wechat-pay] 回调金额不一致:', data.out_trade_no, data.amount.total, '!=', order.amountCents);
                        setResponseStatus(event, 500);
                        return { code: 'FAIL', message: '金额不一致' };
                    }
                }
                await activateMembership(data.out_trade_no, data.transaction_id);
            }
        }

        return { code: 'SUCCESS', message: '成功' };
    } catch (e) {
        console.error('[wechat-pay] 回调处理异常:', e);
        setResponseStatus(event, 500);
        return { code: 'FAIL', message: '处理失败' };
    }
});
