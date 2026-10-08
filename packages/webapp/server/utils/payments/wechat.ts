import WeChatPay from 'better-wechatpay';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { CreatePaymentResult, PaymentContext, PaymentProvider } from './types';

/**
 * 微信支付渠道（better-wechatpay SDK）。
 *
 * 凭据通过环境变量注入（见 .env.example）：
 * - WECHAT_PAY_APP_ID / WECHAT_PAY_MCH_ID / WECHAT_PAY_API_KEY
 * - WECHAT_PAY_PRIVATE_KEY（商户私钥 PEM，支持 WECHAT_PAY_PRIVATE_KEY_PATH 指向文件）
 * - WECHAT_PAY_PUBLIC_KEY（微信支付公钥/平台证书 PEM，SDK 必填）
 * - WECHAT_PAY_NOTIFY_URL（可选，默认 {BETTER_AUTH_URL}/api/pay/notify/wechat）
 *
 * 支付方式路由：
 * - 微信内浏览器 + 有 openid → JSAPI（返回 WeixinJSBridge 拉起参数）
 * - 移动端浏览器 → H5（返回跳转链接）
 * - 桌面浏览器 → Native 扫码（返回 code_url，前端渲染二维码）
 */

/**
 * 等待 SDK 初始化（即平台证书预取）的上限。
 *
 * `/api/pay/notify/wechat` 是无登录态、可被反复触发的入口，而初始化要出网访问微信；
 * 不设上限等于把「外部依赖挂起」直接转成本进程的常驻请求占用。
 * 与 `utils/wechat.ts` 的微信开放接口超时保持同量级。
 */
const SDK_INIT_WAIT_MS = 10_000;

const INIT_TIMED_OUT = Symbol('wechat-pay-init-timeout');

async function raceInit<T>(pending: Promise<T>, ms: number): Promise<T | typeof INIT_TIMED_OUT> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([pending, new Promise<typeof INIT_TIMED_OUT>((resolve) => (timer = setTimeout(() => resolve(INIT_TIMED_OUT), ms)))]);
    } finally {
        clearTimeout(timer);
    }
}

export class WechatPayProvider implements PaymentProvider {
    code = 'wechat';

    private client: Promise<WeChatPay | null> | null = null;

    private isReady(): boolean {
        return Boolean(
            process.env.WECHAT_PAY_APP_ID &&
            process.env.WECHAT_PAY_MCH_ID &&
            process.env.WECHAT_PAY_API_KEY &&
            process.env.WECHAT_PAY_PUBLIC_KEY &&
            this.readPrivateKey(),
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
                return fs.readFileSync(path, 'utf8');
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * 取回**已完成初始化**的 SDK；渠道未配置或初始化失败返回 null。
     *
     * 不能再用 `new WeChatPay(...)`：构造器会发起 `GET /v3/certificates` 预取平台证书，
     * 但**没有任何人 await 那个 promise**，而 `CertificateManager.fetchCertificates` 在记录之后
     * 原样 `throw`。于是商户号/证书不匹配、微信侧 5xx 或一次网络抖动都会以 unhandledRejection
     * 落到 `server/plugins/error-guard.ts` 的 `process.exit(1)`——一次下单请求就能把整台 Nitro
     * 进程连同所有在途流式会话带走。第二个坑是冷启动竞态：证书还没到货时，第一条真实回调会在
     * `Verifier.verify()` 里因为 `platformCertificates` 仍为空而验签失败。
     *
     * `WeChatPay.initialize()` 是官方等待入口（内部 await 同一条 initPromise），外层再 catch 住：
     * 失败既不逃逸，也不被缓存成「支付永久不可用」（下次调用会重试）。
     */
    async ready(): Promise<WeChatPay | null> {
        if (!this.isReady()) return null;
        if (!this.client) {
            this.client = this.createClient().catch((error) => {
                this.client = null;
                console.error('[wechat-pay] SDK 初始化失败（平台证书预取）:', error);
                return null;
            });
        }
        // 超时只放弃「等待」，不放弃那次初始化：在途 promise 仍留在缓存里，下一次调用（微信会重试
        // 回调）继续等同一条预取，既不会每次重开一条外呼，也不会因为这里返回 null 就把它判为失败。
        const verdict = await raceInit(this.client, SDK_INIT_WAIT_MS);
        return verdict === INIT_TIMED_OUT ? null : verdict;
    }

    private async createClient(): Promise<WeChatPay> {
        return WeChatPay.initialize({
            config: {
                appId: process.env.WECHAT_PAY_APP_ID!,
                mchId: process.env.WECHAT_PAY_MCH_ID!,
                apiKey: process.env.WECHAT_PAY_API_KEY!,
                privateKey: this.readPrivateKey()!,
                publicKey: process.env.WECHAT_PAY_PUBLIC_KEY!,
                notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL ?? `${process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'}/api/pay/notify/wechat`,
            },
        });
    }

    /** SDK 实例与 webhook 验签共用（避免重复初始化） */
    static shared(): WechatPayProvider {
        if (!WechatPayProvider.instance) WechatPayProvider.instance = new WechatPayProvider();
        return WechatPayProvider.instance;
    }
    private static instance: WechatPayProvider | null = null;

    async createPayment(ctx: PaymentContext): Promise<CreatePaymentResult> {
        const client = await this.ready();
        if (!client) {
            // 调用方（billing/orders.post）会记日志并统一转成 502，这里不抛 h3 错误也不带渠道细节
            throw new Error('微信支付未配置或初始化失败');
        }
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

        // 移动端浏览器：H5 支付（跳转微信 App 完成支付后回到引导页）
        if (/Mobi|Android|iPhone|iPad/i.test(ctx.userAgent)) {
            const result = (await client.h5.create({
                out_trade_no: ctx.orderNo,
                description: ctx.description,
                amount_cents: ctx.amountCents,
                payer_client_ip: ctx.clientIp ?? '127.0.0.1',
                h5_info: {
                    type: 'Wap',
                    app_name: 'ME',
                    app_url: process.env.BETTER_AUTH_URL ?? 'https://localhost:3000',
                },
            })) as { h5_url: string };
            return { provider: this.code, mode: 'redirect', payUrl: result.h5_url };
        }

        // 桌面浏览器：Native 扫码支付
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
        const client = await this.ready();
        if (!client) return null;
        try {
            const result = (await client.native.query({ out_trade_no: orderNo })) as { trade_state?: string };
            const state = result.trade_state ?? 'UNKNOWN';
            if (state === 'SUCCESS') return 'SUCCESS';
            if (state === 'CLOSED' || state === 'REVOKED' || state === 'PAYERROR') return 'CLOSED';
            if (state === 'NOTPAY') return 'NOTPAY';
            return 'UNKNOWN';
        } catch {
            return null;
        }
    }

    /** 关单；返回 false 表示渠道侧拒绝（常见为用户已支付），调用方此时不应本地置 closed */
    async closeOrder(orderNo: string): Promise<boolean> {
        const client = await this.ready();
        if (!client) return false;
        try {
            await client.native.close(orderNo);
            return true;
        } catch (e) {
            console.warn('[wechat-pay] 关单失败（可能已支付）:', orderNo, e instanceof Error ? e.message : e);
            return false;
        }
    }
}
