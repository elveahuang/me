import { extractApiError, type SessionUser } from '@commons/contract';
import { createAuthClient } from 'better-auth/client';
import { i18n } from '../i18n';

/**
 * 统一的移动端 API 客户端：
 * - 浏览器 / 开发环境走同源 cookie（vite dev 代理到 webapp）
 * - 原生壳（capacitor://localhost 等）没有可用 cookie，改用 better-auth 的 bearer 插件：
 *   登录 / 微信回调拿到的 session token 存到 localStorage，之后所有请求带 Authorization。
 * - 通过 VITE_API_BASE 可指向远端后端（打包原生 App 时使用）。
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? '';
const TOKEN_KEY = 'ee_mobile_token';

/**
 * 普通请求超时。给得比会话探针宽，因为下单/登记附件这类请求有真实副作用，
 * 过早判失败会诱导用户在服务端其实已完成后重复提交。
 */
const API_TIMEOUT_MS = 30_000;

export function getToken(): string | null {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

export function setToken(token: string | null) {
    const previous = getToken();
    try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
    } catch {
        // ignore
    }
    // token 变更意味着缓存里的会话不再属于当前凭据（换账号登录、微信回调换 token、登出）
    if (previous !== token) {
        cachedSession = null;
        sessionConfirmedAt = 0;
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
    /**
     * 弱网下 fetch 可能永久 pending，列表页会一直卡在骨架屏且没有任何错误可显示。
     * 调用方自带 signal 时不接管：它自己的取消语义（组件卸载、用户主动取消）优先于超时。
     * 定时器要到函数退出才清理：超时必须同时覆盖 res.json() 的 body 读取，
     * 否则服务端发完响应头就挂住时，请求依然会无限 pending。
     */
    const controller = options.signal ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), API_TIMEOUT_MS) : null;

    const timeoutError = () => Object.assign(new Error(i18n.global.t('common.apiTimeout', { seconds: Math.round(API_TIMEOUT_MS / 1000) })), { status: 0 });

    try {
        let res: Response;
        try {
            res = await fetch(apiUrl(path), {
                credentials: 'include',
                ...options,
                ...(controller ? { signal: controller.signal } : {}),
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders(options.headers as Record<string, string> | undefined),
                },
            });
        } catch (error) {
            if (controller?.signal.aborted) throw timeoutError();
            const message = error instanceof Error && error.name === 'AbortError' ? error.message : i18n.global.t('common.apiNetworkFailed');
            throw Object.assign(new Error(message), { status: 0, cause: error });
        }

        if (!res.ok) {
            let payload: unknown = null;
            try {
                payload = await res.json();
            } catch {
                if (controller?.signal.aborted) throw timeoutError();
                payload = null;
            }
            const message = extractApiError({ data: payload, status: res.status }, i18n.global.t('common.apiRequestFailed', { status: res.status }));
            throw Object.assign(new Error(message), { status: res.status, data: payload });
        }
        if (res.status === 204) return undefined as T;
        try {
            return (await res.json()) as T;
        } catch (error) {
            if (controller?.signal.aborted) throw timeoutError();
            throw error;
        }
    } finally {
        if (timer) clearTimeout(timer);
    }
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
 * 成功探针的短 TTL 复用：一次导航内守卫与目标页（HomeView/MeView）会背靠背各调一次
 * fetchSession，去重只覆盖并发，连续导航会让每次路由都打一发网络。5s 内的上一次
 * 成功确认直接复用；瞬时故障降级不刷新时间戳，下一次导航仍会重试探针。
 */
const SESSION_FRESH_MS = 5_000;
let sessionConfirmedAt = 0;

type SessionProbe = { ok: true; session: SessionPayload | null } | { ok: false; error: Error };

/** 单次会话探针：只上报结果，不做降级。网络/超时/5xx 归一为可读 Error 交调用方决定 */
async function probeSession(): Promise<SessionProbe> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    try {
        const res = await fetch(apiUrl('/api/auth/get-session'), {
            credentials: 'include',
            headers: authHeaders(),
            signal: controller.signal,
        });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                cachedSession = null;
                // 服务端明确答复「未登录」同样是确定结论，短期内不必再探
                sessionConfirmedAt = Date.now();
                return { ok: true, session: null };
            }
            return { ok: false, error: new Error(i18n.global.t('common.apiRequestFailed', { status: res.status })) };
        }
        const data = (await res.json().catch(() => null)) as SessionPayload | null;
        cachedSession = data?.user ? data : null;
        sessionConfirmedAt = Date.now();
        return { ok: true, session: cachedSession };
    } catch (error) {
        const message = controller.signal.aborted
            ? i18n.global.t('common.apiTimeout', { seconds: Math.round(SESSION_TIMEOUT_MS / 1000) })
            : i18n.global.t('common.apiNetworkFailed');
        return { ok: false, error: Object.assign(new Error(message), { cause: error }) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 获取当前会话（服务端 /api/auth/get-session）。
 * - 2xx：以服务端结果为准，刷新缓存。
 * - 401/403：服务端明确拒绝当前凭据，判定为已登出，清缓存返回 null。
 * - 其它（网络失败 / 超时 / 5xx / 其它 4xx）：视为瞬时故障，保留并返回缓存值，
 *   冷启动无缓存时返回 null，交由调用方决定跳转。
 * - 距上次确定结论（2xx 或 401/403）不足 SESSION_FRESH_MS 时直接复用缓存，不再发请求，
 *   避免一次导航里守卫 + 目标页背靠背各打一发探针。
 */
export function fetchSession(): Promise<SessionPayload | null> {
    if (inflightSession) return inflightSession;
    if (Date.now() - sessionConfirmedAt < SESSION_FRESH_MS) return Promise.resolve(cachedSession);
    inflightSession = (async () => {
        const result = await probeSession();
        return result.ok ? result.session : cachedSession;
    })().finally(() => {
        inflightSession = null;
    });
    return inflightSession;
}

/**
 * 严格版会话刷新：只认服务端本次的明确答复，瞬时故障直接抛错而不是降级缓存。
 * 微信回调拿到新 token 后必须用它——刚登录却因一次抖动读到「上一账号的缓存」判成功并跳转，
 * 会把用户带进「界面已登录、每次请求都 401」的坏状态。成功结果会顺带刷新缓存。
 */
export async function refreshSession(): Promise<SessionPayload | null> {
    const result = await probeSession();
    if (!result.ok) throw result.error;
    return result.session;
}

/**
 * 路由守卫专用：在 fetchSession 语义之外额外回答「服务端是否给出了明确结论」。
 * 冷启动无缓存时一次瞬时故障也会让 fetchSession 返回 null，守卫只能跳登录页；
 * offline=true 表示这是探针失败而非确定未登录，登录页据此提示网络问题，
 * 避免弱网用户误以为自己被登出。并发在途或 TTL 窗口内复用时拿不到独立的失败信息，
 * 按非离线处理（与旧行为一致）。
 */
export async function checkSessionDecision(): Promise<{ session: SessionPayload | null; offline: boolean }> {
    if (inflightSession) {
        return { session: await inflightSession, offline: false };
    }
    if (Date.now() - sessionConfirmedAt < SESSION_FRESH_MS) {
        return { session: cachedSession, offline: false };
    }
    const result = await probeSession();
    return result.ok ? { session: result.session, offline: false } : { session: cachedSession, offline: true };
}

/**
 * 作废 TTL 复用与缓存：认证状态刚发生变化（登录/注册成功、微信回调用新 token 换取会话成功）时调用。
 * 否则 fetchSession 可能把同一次访问里几秒前的 401「确定结论」端给守卫，把刚登录的用户踢回登录页。
 */
export function invalidateSessionCache(): void {
    cachedSession = null;
    sessionConfirmedAt = 0;
}

/** 退出登录：清空本地 token、缓存与服务端会话 */
export async function signOut(): Promise<void> {
    try {
        await authClient.signOut();
    } catch {
        // ignore
    }
    cachedSession = null;
    sessionConfirmedAt = 0;
    setToken(null);
}

export { extractApiError };
