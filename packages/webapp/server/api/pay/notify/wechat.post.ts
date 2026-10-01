import { eq } from 'drizzle-orm';
import { orders } from '../../../db/schema';
import { activateMembership } from '../../../utils/billing';
import { db } from '../../../utils/db';
import { WechatPayProvider } from '../../../utils/payments/wechat';
import { readCappedBodyText } from '../../../utils/request-body';

/**
 * 微信回调正文是加密后的订单通知，正常在 KB 级；给到 256KB 已含足够余量。
 *
 * 本端点是全服务端**唯一**没有登录态、却又会读取请求体的入口（靠平台签名验证，而验签发生在读完正文之后）。
 * `readRawBody` 没有体积参数，任何人打一条 chunked 的大请求就能在签名被检查之前把整个正文缓冲进进程内存，
 * 既不受每用户限流约束（攻击者不需要账号），也不消耗任何业务配额。
 */
const MAX_NOTIFY_BODY_BYTES = 256 * 1024;

/**
 * 微信支付回调通知（微信服务器调用，无登录态，靠平台签名验证）。
 * 必须返回微信约定的 JSON：成功 {code:'SUCCESS'}；失败返回 500 让微信重试。
 */
export default defineEventHandler(async (event) => {
    // 体积闸门刻意放在下面的 try 之外：越限要原样抛 413，不能被兜底 catch 改写成 500「处理失败」。
    // 真实通知远不到这个量级，命中闸门的只可能是垃圾请求，重试与否没有业务影响。
    const declared = Number(getRequestHeader(event, 'content-length'));
    if (Number.isInteger(declared) && declared > MAX_NOTIFY_BODY_BYTES) {
        throw createError({ statusCode: 413, statusMessage: '请求体过大' });
    }
    const body = await readCappedBodyText(event, MAX_NOTIFY_BODY_BYTES);

    try {
        // 必须 await：SDK 构造时的平台证书预取若未到货就验签，`Verifier` 读到空的证书表会直接把
        // 一条真实支付通知判成验签失败（冷启动竞态）。`ready()` 内部已 catch，不会把拒绝逃逸到这里。
        const sdk = await WechatPayProvider.shared().ready();
        if (!sdk) {
            setResponseStatus(event, 500);
            return { code: 'FAIL', message: '微信支付未配置' };
        }

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
                const [order] = await db.select({ amountCents: orders.amountCents }).from(orders).where(eq(orders.orderNo, data.out_trade_no));
                if (!order) {
                    // 验签通过但本地无此单（如渠道测试单）：activateMembership 必然 404，
                    // 回 FAIL 只会让微信无限重试同一笔注定失败的通知。记录后终止重试。
                    console.error('[wechat-pay] 收到未知订单的支付通知:', data.out_trade_no, data.transaction_id);
                    return { code: 'SUCCESS', message: '已忽略未知订单' };
                }
                if (typeof data.amount?.total === 'number' && order.amountCents !== data.amount.total) {
                    console.error('[wechat-pay] 回调金额不一致:', data.out_trade_no, data.amount.total, '!=', order.amountCents);
                    setResponseStatus(event, 500);
                    return { code: 'FAIL', message: '金额不一致' };
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
