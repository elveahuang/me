import { createWechatSession, exchangeWechatCode, fetchWechatUserInfo, resolveWechatRedirect, sessionCookie, upsertWechatUser } from '../../../utils/wechat';

const CLEAR_STATE_COOKIE = 'wechat_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

function htmlPage(message: string) {
    return `<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center;color:#333">${message}</body>`;
}

/**
 * 微信授权回调：code → openid → 找到/创建本地用户 → 建立 better-auth 会话。
 * - webapp 回跳：写入会话 Cookie 后 302 到目标页
 * - 移动端回跳（redirect 为 MOBILE_APP_URL 开头）：302 到移动端页面并以 #token= 携带会话 token
 */
export default defineEventHandler(async (event) => {
    try {
        const query = getQuery(event);
        const code = typeof query.code === 'string' ? query.code : null;
        const state = typeof query.state === 'string' ? query.state : null;
        if (!code) throw createError({ statusCode: 400, statusMessage: '缺少授权码' });
        if (!state) throw createError({ statusCode: 400, statusMessage: '缺少 state' });

        const cookieHeader = getRequestHeader(event, 'cookie') ?? '';
        const cookieState = cookieHeader
            .split(';')
            .map((c) => c.trim())
            .find((c) => c.startsWith('wechat_oauth_state='));
        if (!cookieState) {
            throw createError({ statusCode: 400, statusMessage: '授权状态过期，请重新发起登录' });
        }

        const stateValue = cookieState.split('=').slice(1).join('=');
        const [expectedState, rawRedirect] = stateValue.split('|');
        if (state !== expectedState) {
            throw createError({ statusCode: 400, statusMessage: '授权状态校验失败' });
        }
        const redirect = decodeURIComponent(rawRedirect ?? '/chat');

        const token = await exchangeWechatCode(code);
        const profile = await fetchWechatUserInfo(token.access_token, token.openid);
        const userId = await upsertWechatUser(token.openid, {
            nickname: profile.nickname,
            headimgurl: profile.headimgurl,
        });

        const headers = getRequestHeaders(event);
        const { token: sessionToken } = await createWechatSession({
            userId,
            userAgent: headers['user-agent'],
            ip: headers['x-forwarded-for']?.split(',')[0],
        });

        const target = resolveWechatRedirect(redirect);
        if (!target) {
            setHeader(event, 'set-cookie', CLEAR_STATE_COOKIE);
            setResponseStatus(event, 400);
            return htmlPage('非法的回跳地址');
        }

        if (target.kind === 'mobile') {
            const sep = target.url.includes('#') ? '' : '#';
            setHeader(event, 'set-cookie', CLEAR_STATE_COOKIE);
            return sendRedirect(event, `${target.url}${sep}token=${sessionToken}`, 302);
        }

        const cookieVal = await sessionCookie(sessionToken);
        appendResponseHeader(event, 'set-cookie', cookieVal);
        appendResponseHeader(event, 'set-cookie', CLEAR_STATE_COOKIE);
        return sendRedirect(event, target.path, 302);
    } catch (e: any) {
        setHeader(event, 'set-cookie', CLEAR_STATE_COOKIE);
        setResponseStatus(event, e?.statusCode || 500);
        return htmlPage(e?.statusMessage || e?.message || '微信登录失败，请稍后重试');
    }
});
