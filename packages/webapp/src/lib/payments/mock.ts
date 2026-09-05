import type { CreatePaymentResult, PaymentContext, PaymentProvider } from './types';

/**
 * 开发环境模拟支付渠道。
 * 当微信支付凭据未配置时自动兜底，让下单 → 支付 → 开通会员的全流程可以在本地跑通：
 * createPayment 直接返回 mock 模式，前端轮询订单状态时由
 * POST /api/billing/orders/:orderNo/mock-pay 将订单置为已支付。
 *
 * 生产环境安全闸门：微信凭据齐全时本渠道不可用（防绕过真实支付免费开通会员）。
 */
export class MockPayProvider implements PaymentProvider {
    code = 'mock';

    isConfigured(): boolean {
        const wechatReady = Boolean(process.env.WECHAT_PAY_APP_ID && process.env.WECHAT_PAY_MCH_ID && process.env.WECHAT_PAY_API_KEY);
        return !wechatReady || process.env.NODE_ENV !== 'production';
    }

    async createPayment(_ctx: PaymentContext): Promise<CreatePaymentResult> {
        return { provider: this.code, mode: 'mock' };
    }

    async queryOrder(): Promise<'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'UNKNOWN' | null> {
        return null;
    }

    async closeOrder(): Promise<void> {
        // mock 渠道无需关单
    }
}
