import crypto from 'node:crypto';
import WeChatPay from 'better-wechatpay';
import type { CreatePaymentResult, PaymentContext, PaymentProvider } from './types';

/**
 * 微信支付渠道（better-wechatpay SDK）。
 *
 * 凭据通过环境变量注入（见 .env.example）：
 * - WECHAT_PAY_APP_ID / WECHAT_PAY_MCH_ID / WECHAT_PAY_API_KEY
 * - WECHAT_PAY_PRIVATE_KEY（商户私钥 PEM，支持 WECHAT_PAY_PRIVATE_KEY_PATH 指向文件）
 * - WECHAT_PAY_PUBLIC_KEY（微信支付公钥/平台证书 PEM）
 * - WECHAT_PAY_NOTIFY_URL（回调地址，默认 {BETTER_AUTH_URL}/api/pay/notify/wechat）
 *
 * 支付方式路由：
 * - 微信内浏览器 + 有 openid → JSAPI（返回 WeixinJSBridge 拉起参数）
 * - 其他环境 → Native 扫码（返回 code_url，前端渲染二维码）
 */
export class WechatPayProvider implements PaymentProvider {
    code = 'wechat';

    private client: WeChatPay | null = null;

    private isReady(): boolean {
        return Boolean(
            process.env.WECHAT_PAY_APP_ID && process.env.WECHAT_PAY_MCH_ID && process.env.WECHAT_PAY_API_KEY && this.readPrivateKey(),
        );
    }

    isConfigured(): boolean {
        return this.isReady();
    }

    private readPrivateKey(): string | null {
        if (process.env.WECHAT_PAY_PRIVATE_KEY) return process.env.WECHAT_PAY_PRIVATE_KEY.replace(/\\n/g, '\n');
        const path = process.env.WECHAT_PAY_PRIVATE_KEY_PATH;
        if (path) {
            try {
                // 同步读取：密钥文件在服务启动后即固定
                return require('node:fs').readFileSync(path, 'utf8');
            } catch {
                return null;
            }
        }
        return null;
    }

    private getClient(): WeChatPay {
        if (!this.client) {
            this.client = new WeChatPay({
                config: {
                    appId: process.env.WECHAT_PAY_APP_ID!,
                    mchId: process.env.WECHAT_PAY_MCH_ID!,
                    apiKey: process.env.WECHAT_PAY_API_KEY!,
                    privateKey: this.readPrivateKey()!,
                    publicKey: process.env.WECHAT_PAY_PUBLIC_KEY ?? '',
                    notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL,
                },
            });
        }
        return this.client;
    }

    /** SDK 实例与 webhook 验签共用（避免重复初始化） */
    static shared(): WechatPayProvider {
        if (!WechatPayProvider.instance) WechatPayProvider.instance = new WechatPayProvider();
        return WechatPayProvider.instance;
    }
    private static instance: WechatPayProvider | null = null;

    /** 暴露底层 SDK 给回调验签使用 */
    get sdk(): WeChatPay | null {
        if (!this.isReady()) return null;
        return this.getClient();
    }

    async createPayment(ctx: PaymentContext): Promise<CreatePaymentResult> {
        const client = this.getClient();
        const inWechat = /MicroMessenger/i.test(ctx.userAgent);

        if (inWechat && ctx.openid) {
            // 公众号内 JSAPI 支付
            const result = (await client.jsapi.create({
                out_trade_no: ctx.orderNo,
                description: ctx.description,
                amount_cents: ctx.amountCents,
                openid: ctx.openid,
            })) as { prepay_id: string };
            return {
                provider: this.code,
                mode: 'jsapi',
                jsapiParams: this.signJsapi(result.prepay_id),
            };
        }

        // 桌面/移动浏览器：Native 扫码支付
        const result = (await client.native.create({
            out_trade_no: ctx.orderNo,
            description: ctx.description,
            amount_cents: ctx.amountCents,
        })) as { code_url: string };
        return { provider: this.code, mode: 'qrcode', payUrl: result.code_url };
    }

    /** 生成 JSAPI 拉起签名（RSA-SHA256：appid\ntimeStamp\nnonceStr\npackage\n） */
    private signJsapi(prepayId: string): CreatePaymentResult['jsapiParams'] {
        const privateKey = this.readPrivateKey()!;
        const appId = process.env.WECHAT_PAY_APP_ID!;
        const timeStamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = crypto.randomBytes(16).toString('hex');
        const pkg = `prepay_id=${prepayId}`;
        const message = `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
        const paySign = crypto.createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
        return { appId, timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign };
    }

    async queryOrder(orderNo: string): Promise<'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'UNKNOWN' | null> {
        if (!this.isReady()) return null;
        try {
            const result = (await this.getClient().native.query({ out_trade_no: orderNo })) as { trade_state?: string };
            const state = result.trade_state ?? 'UNKNOWN';
            if (state === 'SUCCESS') return 'SUCCESS';
            if (state === 'CLOSED' || state === 'REVOKED' || state === 'PAYERROR') return 'CLOSED';
            if (state === 'NOTPAY' || state === 'USERPAYING') return 'NOTPAY';
            return 'UNKNOWN';
        } catch {
            return null;
        }
    }

    async closeOrder(orderNo: string): Promise<void> {
        if (!this.isReady()) return;
        try {
            await this.getClient().native.close(orderNo);
        } catch {
            // 微信侧可能已关闭/已支付，忽略关单失败
        }
    }
}
