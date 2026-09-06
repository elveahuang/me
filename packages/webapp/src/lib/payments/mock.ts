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
        if (process.env.NODE_ENV === 'production') {
            // 生产环境安全闸门：仅当显式开启 MOCK_PAY_ENABLED 时才允许 mock 渠道
            // （例如生产环境尚未配置微信支付时的过渡期），否则一律拒绝，防 0 元开通会员
            return process.env.MOCK_PAY_ENABLED === 'true';
        }
        return true;
    }

    async createPayment(_ctx: PaymentContext): Promise<CreatePaymentResult> {
        return { provider: this.code, mode: 'mock' };
    }

    async queryOrder(): Promise<'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'UNKNOWN' | null> {
        // mock 订单在 mock-pay 前始终概念上"未支付"；超时关单走正常 NOTPAY 分支
        return 'NOTPAY';
    }

    async closeOrder(): Promise<boolean> {
        // mock 渠道无需关单
        return true;
    }
}
