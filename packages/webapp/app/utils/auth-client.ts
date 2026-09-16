import { createAuthClient } from 'better-auth/vue';

export const authClient = createAuthClient();

export interface SessionUser {
    id: string;
    name: string;
    email: string;
    role: string;
    image?: string | null;
}

/**
 * 获取当前会话。SSR 时必须透传浏览器原始请求的 cookie，
 * 否则服务端渲染期间拿不到会话（刷新认证页会被踢回登录页）。
 */
export async function fetchSession(headers?: Record<string, string>): Promise<{ user: SessionUser } | null> {
    try {
        const res = await $fetch<any>('/api/auth/get-session', headers ? { headers } : undefined);
        return res?.user ? res : null;
    } catch {
        return null;
    }
}

/** 在 Nuxt 上下文里取 SSR cookie 头（客户端返回 undefined）。 */
export function ssrCookieHeaders(): Record<string, string> | undefined {
    if (import.meta.server) {
        return useRequestHeaders(['cookie']) as Record<string, string>;
    }
    return undefined;
}
