import crypto from 'node:crypto';
import { buildWechatAuthorizeUrl, isWechatInBrowser, isWechatOAuthConfigured, resolveWechatRedirect } from '../../utils/wechat';

/**
 * 微信公众号网页授权登录入口。
 * GET /api/auth/wechat?redirect=/chat
 */
export default defineEventHandler((event) => {
    if (!isWechatOAuthConfigured()) {
        throw createError({ statusCode: 501, statusMessage: '微信登录未配置' });
    }

    const query = getQuery(event);
    // 授权码只能在微信客户端内兑换：普通浏览器直接 302 过去只会落在微信自己的报错页，
    // 同域先挡回来能给出可读原因。移动端（Capacitor WebView，UA 不含 MicroMessenger）
    // 靠 client=mobile 放行，回跳目标仍由 resolveWechatRedirect 按 MOBILE_APP_URL origin 校验。
    const client = typeof query.client === 'string' ? query.client : '';
    if (client !== 'mobile' && !isWechatInBrowser(getRequestHeader(event, 'user-agent') ?? '')) {
        throw createError({ statusCode: 400, statusMessage: '请在微信中打开页面后再使用微信登录' });
    }
    const redirectParam = typeof query.redirect === 'string' ? query.redirect : null;
    const target = resolveWechatRedirect(redirectParam);
    if (!target) {
        throw createError({ statusCode: 400, statusMessage: '非法的回跳地址' });
    }
    const redirect = target.kind === 'mobile' ? target.url : target.path;

    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = process.env.WECHAT_OAUTH_REDIRECT_URL ?? `${process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'}/api/auth/wechat/callback`;
    const authorizeUrl = buildWechatAuthorizeUrl({ redirectUri, state });

    const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
    const stateCookie = `wechat_oauth_state=${state}|${encodeURIComponent(redirect)}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=300`;

    setHeader(event, 'set-cookie', stateCookie);
    return sendRedirect(event, authorizeUrl, 302);
});
