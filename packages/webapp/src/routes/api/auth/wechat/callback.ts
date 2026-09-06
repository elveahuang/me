import { HttpError } from '@/lib/api';
import { createWechatSession, exchangeWechatCode, fetchWechatUserInfo, resolveWechatRedirect, sessionCookie, upsertWechatUser } from '@/lib/wechat';
import { createFileRoute } from '@tanstack/react-router';

type RouteParams = { request: Request };

const CLEAR_STATE_COOKIE = 'wechat_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

function htmlPage(message: string, status: number, extraHeaders?: Record<string, string>): Response {
    return new Response(`<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center;color:#333">${message}</body>`, {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8', ...extraHeaders },
    });
}

/**
 * 微信授权回调：code → openid → 找到/创建本地用户 → 建立 better-auth 会话。
 * - webapp 回跳：写入会话 Cookie 后 302 到目标页
 * - 移动端回跳（redirect 为 MOBILE_APP_URL 开头）：302 到移动端页面并以 #token= 携带会话 token
 */
export const Route = createFileRoute('/api/auth/wechat/callback')({
    server: {
        handlers: {
            GET: async ({ request }: RouteParams) => {
                try {
                    const url = new URL(request.url);
                    const code = url.searchParams.get('code');
                    const state = url.searchParams.get('state');
                    if (!code) throw new HttpError(400, '缺少授权码');
                    if (!state) throw new HttpError(400, '缺少 state');

                    const cookieState = request.headers
                        .get('cookie')
                        ?.split(';')
                        .map((c) => c.trim())
                        .find((c) => c.startsWith('wechat_oauth_state='));
                    if (!cookieState) throw new HttpError(400, '授权状态过期，请重新发起登录');
                    const stateValue = cookieState.split('=').slice(1).join('=');
                    const [expectedState, rawRedirect] = stateValue.split('|');
                    if (state !== expectedState) throw new HttpError(400, '授权状态校验失败');
                    const redirect = decodeURIComponent(rawRedirect ?? '/chat');

                    // 授权一次性，立刻消费 state
                    const token = await exchangeWechatCode(code);
                    const profile = await fetchWechatUserInfo(token.access_token, token.openid);
                    const userId = await upsertWechatUser(token.openid, {
                        nickname: profile.nickname,
                        headimgurl: profile.headimgurl,
                    });
                    const { token: sessionToken } = await createWechatSession({
                        userId,
                        userAgent: request.headers.get('user-agent') ?? undefined,
                        ip: request.headers.get('x-forwarded-for')?.split(',')[0] ?? undefined,
                    });

                    // 回跳地址在发起时已校验过一次，回调侧再校验（防 state cookie 被篡改）
                    const target = resolveWechatRedirect(redirect);
                    if (!target) return htmlPage('非法的回跳地址', 400, { 'set-cookie': CLEAR_STATE_COOKIE });

                    if (target.kind === 'mobile') {
                        // 移动端：token 通过 URL fragment 传递（不会进入服务器/代理日志）
                        const sep = target.url.includes('#') ? '' : '#';
                        return new Response(null, {
                            status: 302,
                            headers: { location: `${target.url}${sep}token=${sessionToken}`, 'set-cookie': CLEAR_STATE_COOKIE },
                        });
                    }

                    return new Response(null, {
                        status: 302,
                        headers: { location: target.path, 'set-cookie': `${await sessionCookie(sessionToken)}, ${CLEAR_STATE_COOKIE}` },
                    });
                } catch (e) {
                    if (e instanceof HttpError) return htmlPage(e.message, e.status, { 'set-cookie': CLEAR_STATE_COOKIE });
                    console.error('[wechat-oauth] 回调处理失败:', e);
                    return htmlPage('微信登录失败，请稍后重试', 500, { 'set-cookie': CLEAR_STATE_COOKIE });
                }
            },
        },
    },
});
