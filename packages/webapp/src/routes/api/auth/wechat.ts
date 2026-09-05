import { HttpError } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { buildWechatAuthorizeUrl, isWechatOAuthConfigured } from '@/lib/wechat';
import { createFileRoute } from '@tanstack/react-router';
import crypto from 'node:crypto';

type RouteParams = { request: Request };

/**
 * 微信公众号网页授权登录入口。
 * GET /api/auth/wechat?redirect=/chat
 * 仅支持微信内浏览器打开（公众号网页授权限制）；未配置凭据时返回 501。
 */
export const Route = createFileRoute('/api/auth/wechat')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }: RouteParams) => {
                try {
                    if (!isWechatOAuthConfigured()) throw new HttpError(501, '微信登录未配置（WECHAT_OAUTH_APP_ID / WECHAT_OAUTH_APP_SECRET）');

                    const url = new URL(request.url);
                    const redirect = url.searchParams.get('redirect') ?? '/chat';
                    if (!redirect.startsWith('/') && !redirect.startsWith(process.env.MOBILE_APP_URL ?? '##none##')) {
                        throw new HttpError(400, '非法的回跳地址');
                    }

                    const state = crypto.randomBytes(16).toString('hex');
                    const redirectUri =
                        process.env.WECHAT_OAUTH_REDIRECT_URL ?? `${process.env.BETTER_AUTH_URL ?? url.origin}/api/auth/wechat/callback`;
                    const authorizeUrl = buildWechatAuthorizeUrl({ redirectUri, state });

                    // state 与回跳地址一起放进短时 Cookie，回调时校验防 CSRF
                    const stateCookie = `wechat_oauth_state=${state}|${encodeURIComponent(redirect)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`;
                    return new Response(null, { status: 302, headers: { location: authorizeUrl, 'set-cookie': stateCookie } });
                } catch (e) {
                    // 授权入口在浏览器中直接访问，错误以 HTML 呈现而非 JSON
                    const message = e instanceof Error ? e.message : '微信登录不可用';
                    return new Response(`<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center;color:#666">${message}</body>`, {
                        status: e instanceof HttpError ? e.status : 500,
                        headers: { 'content-type': 'text/html; charset=utf-8' },
                    });
                }
            },
        },
    },
});
