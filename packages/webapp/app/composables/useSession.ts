import type { SessionUser } from '~/utils/auth-client';
import { fetchSession, ssrCookieHeaders } from '~/utils/auth-client';

/**
 * 全局会话状态。
 *
 * 之前头部导航、后台侧栏、各页面各自 `ref(null)` + `onMounted(fetchSession)`，
 * 结果是每次挂载都打一次 /api/auth/get-session，且 SSR 首屏拿不到会话（导航栏先渲染成未登录态再闪成已登录）。
 * 这里用 useState 缓存：SSR 阶段就取一次，客户端跨组件共享同一个结果。
 */
export function useSession() {
    const session = useState<{ user: SessionUser } | null>('session', () => null);
    const pending = useState<boolean>('session-pending', () => false);

    /** 拉取并缓存会话；已加载过则直接复用 */
    async function load(force = false) {
        if (session.value && !force) return session.value;
        if (pending.value) return session.value;
        pending.value = true;
        try {
            session.value = (await fetchSession(ssrCookieHeaders())) as { user: SessionUser } | null;
        } finally {
            pending.value = false;
        }
        return session.value;
    }

    async function signOut() {
        const { authClient } = await import('~/utils/auth-client');
        await authClient.signOut();
        session.value = null;
    }

    return {
        session,
        pending,
        load,
        signOut,
        isAdmin: computed(() => session.value?.user?.role === 'admin'),
    };
}
