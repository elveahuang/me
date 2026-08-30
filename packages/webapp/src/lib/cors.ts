import { createMiddleware } from '@tanstack/react-start';

/**
 * API 路由共用 CORS 中间件。
 * 默认放行本地开发端口（Expo web / Ionic / Vite），可通过 CORS_ORIGINS 环境变量覆盖（逗号分隔）。
 */
const allowedOrigins = new Set(
    (
        process.env.CORS_ORIGINS ??
        'http://localhost:8081,http://localhost:8100,http://localhost:5173,http://localhost:19006,capacitor://localhost,http://localhost'
    )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
);

function corsHeaders(origin: string | null): Record<string, string> {
    const allowOrigin = origin && allowedOrigins.has(origin) ? origin : '*';
    return {
        'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization',
        'access-control-expose-headers': 'x-conversation-id',
        'access-control-allow-origin': allowOrigin,
        vary: 'Origin',
    };
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

/** 附加到实际 JSON / 流式响应上的 CORS 头 */
export function corsResponseHeaders(): Record<string, string> {
    return {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'x-conversation-id',
    };
}
