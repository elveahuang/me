import { MockPayProvider } from './mock';
import type { PaymentProvider } from './types';
import { WechatPayProvider } from './wechat';

export type { CreatePaymentResult, PaymentContext, PaymentProvider } from './types';

const providers = new Map<string, PaymentProvider>();

function register(provider: PaymentProvider) {
    providers.set(provider.code, provider);
}

register(WechatPayProvider.shared());
register(new MockPayProvider());

/** 按编码取渠道；未注册抛 400 语义错误 */
export function getPaymentProvider(code: string): PaymentProvider {
    const provider = providers.get(code);
    if (!provider) throw new Error(`未知的支付渠道: ${code}`);
    return provider;
}

/** 列出对客户端可见的渠道（mock 仅在微信未配置时暴露） */
export function listPaymentProviders(): { code: string; available: boolean }[] {
    const wechatReady = providers.get('wechat')?.isConfigured() ?? false;
    return [
        { code: 'wechat', available: wechatReady },
        { code: 'mock', available: !wechatReady },
    ];
}
