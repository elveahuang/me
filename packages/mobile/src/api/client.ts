import { extractApiError, type SessionUser } from '@commons/contract';
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

/** get-session 是纯读取，超时后可安全放弃；给足慢网络但仍避免永久挂起 */
const SESSION_TIMEOUT_MS = 10_000;

/**
 * 最近一次确认过的会话。用于在瞬时故障（网络抖动 / 超时 / 5xx）时降级返回，
 * 防止路由守卫把「已经登录、只是这一次请求失败」的用户误踢回登录页。
 */
let cachedSession: SessionPayload | null = null;
/** 并发去重：守卫与页面可能同时拉会话，共用一次在途请求 */
let inflightSession: Promise<SessionPayload | null> | null = null;

/**
 * 获取当前会话（服务端 /api/auth/get-session）。
 * - 2xx：以服务端结果为准，刷新缓存。
 * - 401/403：服务端明确拒绝当前凭据，判定为已登出，清缓存返回 null。
 * - 其它（网络失败 / 超时 / 5xx / 其它 4xx）：视为瞬时故障，保留并返回缓存值，
 *   冷启动无缓存时返回 null，交由调用方决定跳转。
 */
export function fetchSession(): Promise<SessionPayload | null> {
    if (inflightSession) return inflightSession;
    inflightSession = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
        try {
            const res = await fetch(apiUrl('/api/auth/get-session'), {
                credentials: 'include',
                headers: authHeaders(),
                signal: controller.signal,
            });
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) cachedSession = null;
                return cachedSession;
            }
            const data = (await res.json().catch(() => null)) as SessionPayload | null;
            cachedSession = data?.user ? data : null;
            return cachedSession;
        } catch {
            return cachedSession;
        } finally {
            clearTimeout(timer);
            inflightSession = null;
        }
    })();
    return inflightSession;
}

/** 退出登录：清空本地 token、缓存与服务端会话 */
export async function signOut(): Promise<void> {
    try {
        await authClient.signOut();
    } catch {
        // ignore
    }
    cachedSession = null;
    setToken(null);
}

export { extractApiError };
