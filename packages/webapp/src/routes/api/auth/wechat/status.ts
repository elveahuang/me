import { json } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { isWechatOAuthConfigured } from '@/lib/wechat';
import { createFileRoute } from '@tanstack/react-router';

type RouteParams = { request: Request };

/**
 * 微信登录是否可用（公开端点：登录页据此显示/隐藏微信登录按钮）。
 * `?client=mobile`：移动端回跳依赖 MOBILE_APP_URL 配置，未配置时对 mobile 返回不可用，
 * 避免用户在微信内走完授权后落入服务端错误页。
 */
export const Route = createFileRoute('/api/auth/wechat/status')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }: RouteParams) => {
                const client = new URL(request.url).searchParams.get('client');
                if (client === 'mobile') {
                    return json({ enabled: isWechatOAuthConfigured() && Boolean(process.env.MOBILE_APP_URL) });
                }
                return json({ enabled: isWechatOAuthConfigured() });
            },
        },
    },
});
