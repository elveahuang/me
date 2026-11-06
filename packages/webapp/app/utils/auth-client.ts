import type { SessionUser } from '@commons/contract';
import { createAuthClient } from 'better-auth/vue';

export const authClient = createAuthClient();

// 会话用户形状以 contract 为唯一事实源（contract 版本多出的 banned/emailVerified 是
// better-auth 实际返回的字段，探针响应里本就存在，只是早先这里抄了一份缺字段的子集）。
export type { SessionUser };

/**
 * 会话探测结果。
 *
 * 区分「确实没登录」和「问不到」很重要：把网络抖动/5xx 也当成未登录，
 * 路由守卫就会在一次瞬时故障里把已登录用户踢回登录页并丢掉他正在写的页面。
 */
type SessionOutcome = { status: 'signed-in'; session: { user: SessionUser } } | { status: 'anonymous' } | { status: 'error' };

/** 只有 401/403 是会话本身无效；其余状态码都是探针不可用 */
function isRejectedByAuth(error: unknown): boolean {
    const e = error as { statusCode?: number; status?: number; response?: { status?: number } };
    const status = e?.statusCode ?? e?.status ?? e?.response?.status;
    return status === 401 || status === 403;
}

export async function resolveSession(headers?: Record<string, string>): Promise<SessionOutcome> {
    try {
        const res = await $fetch<{ user?: SessionUser } | null>('/api/auth/get-session', headers ? { headers } : undefined);
        return res?.user ? { status: 'signed-in', session: res as { user: SessionUser } } : { status: 'anonymous' };
    } catch (error) {
        return isRejectedByAuth(error) ? { status: 'anonymous' } : { status: 'error' };
    }
}

/**
 * 获取当前会话。SSR 时必须透传浏览器原始请求的 cookie，
 * 否则服务端渲染期间拿不到会话（刷新认证页会被踢回登录页）。
 *
 * 返回值把「会话无效」和「探测失败」都折叠成 null，适合只关心展示的场景。
 * 路由守卫要用 resolveSession() 区分两者，不要在抖动时判为登出。
 */
export async function fetchSession(headers?: Record<string, string>): Promise<{ user: SessionUser } | null> {
    const outcome = await resolveSession(headers);
    return outcome.status === 'signed-in' ? outcome.session : null;
}

/** 在 Nuxt 上下文里取 SSR cookie 头（客户端返回 undefined）。 */
export function ssrCookieHeaders(): Record<string, string> | undefined {
    if (import.meta.server) {
        return useRequestHeaders(['cookie']) as Record<string, string>;
    }
    return undefined;
}
