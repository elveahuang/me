import { createMiddleware } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

/**
 * API 路由共用 CORS 中间件。
 * 默认放行本地开发端口（Ionic / Vite / Capacitor），可通过 CORS_ORIGINS 环境变量覆盖（逗号分隔）。
 * 仅对白名单内的 Origin 回显 allow-origin，其余来源不附加该头（浏览器将拒绝读取响应）。
 */
const allowedOrigins = new Set(
    (process.env.CORS_ORIGINS ?? 'http://localhost:8100,http://localhost:5173,capacitor://localhost,https://localhost')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
);

function allowOrigin(origin: string | null | undefined): string | null {
    return origin && allowedOrigins.has(origin) ? origin : null;
}

function corsHeaders(origin: string | null | undefined): Record<string, string> {
    const headers: Record<string, string> = {
        'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization',
        'access-control-expose-headers': 'x-conversation-id',
        vary: 'Origin',
    };
    const allowed = allowOrigin(origin);
    if (allowed) headers['access-control-allow-origin'] = allowed;
    return headers;
}

/**
 * CORS 预检短路：其余方法直接放行。
 * 说明：TanStack Start 路由级中间件的 next() 拿不到框架最终生成的 Response，
 * 因此实际响应上的 CORS 头（allow-origin/expose-headers）由 api.ts 的 json()
 * 与 chat.ts 的流式响应统一附加。
 */
export const corsMiddleware = createMiddleware().server(async ({ request, next }) => {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
    }
    return next();
});

/** 附加到实际 JSON / 流式响应上的 CORS 头（仅对白名单来源回显 Origin） */
export function corsResponseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        'access-control-expose-headers': 'x-conversation-id',
        vary: 'Origin',
    };
    try {
        const allowed = allowOrigin(getRequest().headers.get('origin'));
        if (allowed) headers['access-control-allow-origin'] = allowed;
    } catch {
        // 非 request 上下文（如后台任务构造响应）不附加 allow-origin
    }
    return headers;
}
