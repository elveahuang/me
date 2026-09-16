import { extractApiError, type SessionUser } from '@contract';
import { createAuthClient } from 'better-auth/client';

/**
 * 统一的移动端 API 客户端：
 * - 浏览器 / 开发环境走同源 cookie（vite dev 代理到 webapp）
 * - 原生壳（capacitor://localhost 等）没有可用 cookie，改用 better-auth 的 bearer 插件：
 *   登录 / 微信回调拿到的 session token 存到 localStorage，之后所有请求带 Authorization。
 * - 通过 VITE_API_BASE 可指向远端后端（打包原生 App 时使用）。
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? '';
const TOKEN_KEY = 'ee_mobile_token';

export function getToken(): string | null {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

export function setToken(token: string | null) {
    try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
    } catch {
        // ignore
    }
}

/** 拼接 API 地址（原生壳下指向远端后端） */
export function apiUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}`, ...(extra ?? {}) } : { ...(extra ?? {}) };
}

/** 通用 JSON 请求；失败时抛出带可读文案的错误 */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(apiUrl(path), {
        credentials: 'include',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(options.headers as Record<string, string> | undefined),
        },
    });
    if (!res.ok) {
        let payload: unknown = null;
        try {
            payload = await res.json();
        } catch {
            payload = null;
        }
        const message = extractApiError({ data: payload, status: res.status }, `请求失败（${res.status}）`);
        throw Object.assign(new Error(message), { status: res.status, data: payload });
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

export const authClient = createAuthClient({
    baseURL: API_BASE || undefined,
    fetchOptions: {
        credentials: 'include',
        // bearer 插件会回传 set-auth-token，原生壳下持久化后即可脱离 cookie 使用
        onSuccess: (ctx: any) => {
            const token = ctx?.response?.headers?.get?.('set-auth-token');
            if (token) setToken(token);
        },
        onRequest: (ctx: any) => {
            const token = getToken();
            if (token) ctx.headers.set('Authorization', `Bearer ${token}`);
        },
    },
});

export interface SessionPayload {
    user: SessionUser;
    session?: { id: string; expiresAt: string };
}

/** 获取当前会话（服务端 /api/auth/get-session） */
export async function fetchSession(): Promise<SessionPayload | null> {
    try {
        const res = await fetch(apiUrl('/api/auth/get-session'), {
            credentials: 'include',
            headers: authHeaders(),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as SessionPayload | null;
        return data?.user ? data : null;
    } catch {
        return null;
    }
}

/** 退出登录：清空本地 token 与服务端会话 */
export async function signOut(): Promise<void> {
    try {
        await authClient.signOut();
    } catch {
        // ignore
    }
    setToken(null);
}

export { extractApiError };
