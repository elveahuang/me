import { isWechatOAuthConfigured } from '../../../utils/wechat';

/**
 * 微信登录是否可用（公开端点）。
 * 移动端需要绝对地址回跳才能在原生壳 / 独立端口下拿到会话 token，这里一并下发。
 */
export default defineEventHandler((event) => {
    const query = getQuery(event);
    if (query.client === 'mobile') {
        const mobileBase = process.env.MOBILE_APP_URL;
        let redirectUrl: string | null = null;
        if (mobileBase) {
            try {
                redirectUrl = new URL('wechat-callback', mobileBase).toString();
            } catch {
                redirectUrl = null;
            }
        }
        return { enabled: isWechatOAuthConfigured() && Boolean(redirectUrl), redirectUrl };
    }
    return { enabled: isWechatOAuthConfigured() };
});
