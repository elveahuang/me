import { json } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { isWechatOAuthConfigured } from '@/lib/wechat';
import { createFileRoute } from '@tanstack/react-router';

type RouteParams = { request: Request };

/** 微信登录是否可用（公开端点：登录页据此显示/隐藏微信登录按钮） */
export const Route = createFileRoute('/api/auth/wechat/status')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async (_ctx: RouteParams) => json({ enabled: isWechatOAuthConfigured() }),
        },
    },
});
