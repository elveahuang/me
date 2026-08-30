import { createMiddleware, createServerFn } from '@tanstack/react-start';
import { auth } from './auth';

/**
 * 把 better-auth 会话注入 server function 上下文。
 * 处理器中通过 `context.session` 访问（可能为 null）。
 */
export const sessionMiddleware = createMiddleware().server(async ({ request, next }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    return next({ context: { session } });
});

/** 在路由 beforeLoad / loader 中调用，返回当前会话（未登录为 null）。 */
export const fetchSession = createServerFn({ method: 'GET' })
    .middleware([sessionMiddleware])
    .handler(({ context }) => context.session);

export function isAdminRole(role: string | null | undefined) {
    return (role ?? '')
        .split(',')
        .map((r) => r.trim())
        .includes('admin');
}
