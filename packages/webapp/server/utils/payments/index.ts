import { MockPayProvider } from './mock';
import type { PaymentProvider } from './types';
import { WechatPayProvider } from './wechat';

const providers = new Map<string, PaymentProvider>();

function register(provider: PaymentProvider) {
    providers.set(provider.code, provider);
}

register(WechatPayProvider.shared());
register(new MockPayProvider());

/** 按编码取渠道；未注册按 400 语义抛出 */
export function getPaymentProvider(code: string): PaymentProvider {
    const provider = providers.get(code);
    if (!provider) {
        throw createError({ statusCode: 400, statusMessage: `未知的支付渠道: ${code}` });
    }
    return provider;
}

/**
 * 列出对客户端可见的渠道。
 * 可用性一律以渠道自身的 isConfigured() 为准：生产环境未显式开启 MOCK_PAY_ENABLED 时
 * mock 渠道不可用，前端不应展示（否则下单才报「支付渠道未配置」）。
 */
export function listPaymentProviders(): { code: string; available: boolean }[] {
    return [
        { code: 'wechat', available: providers.get('wechat')?.isConfigured() ?? false },
        { code: 'mock', available: providers.get('mock')?.isConfigured() ?? false },
    ];
}

/** 自动选择支付渠道：微信优先，其次 mock，都不可用时返回 null */
export function resolvePaymentProviderCode(code = 'auto'): string | null {
    if (code !== 'auto') {
        return getPaymentProvider(code).isConfigured() ? code : null;
    }
    const candidates = ['wechat', 'mock'];
    return candidates.find((c) => providers.get(c)?.isConfigured()) ?? null;
}
