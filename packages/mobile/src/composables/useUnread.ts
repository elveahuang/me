import { ref } from 'vue';
import { api } from '../api/client';

/**
 * 未读消息数的共享状态。
 *
 * 移动端的「首页」「我的」与导航都可能展示未读角标。若各自维护一份 ref，
 * 用户在消息页读完消息返回后角标仍是旧值，看起来像没生效。
 * 这里用模块级单例（composable 的标准做法）：所有引用同一份响应式状态，
 * 任意页面刷新后其余页面立即同步。
 */

const unread = ref(0);
let inflight: Promise<number> | null = null;
let lastFetchAt = 0;

/** 拉取未读数（带并发合并与 5 秒节流，避免多页面同时触发的重复请求） */
async function refresh(force = false): Promise<number> {
    const now = Date.now();
    if (!force && now - lastFetchAt < 5000) return unread.value;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const res = await api<{ unread: number }>('/api/notifications/unread');
            unread.value = res.unread ?? 0;
            lastFetchAt = Date.now();
            return unread.value;
        } catch {
            // 角标属于辅助信息：请求失败时保留上一个已知值，不打扰用户
            return unread.value;
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

/** 本地更新（如标记已读后由接口返回的权威值） */
function setUnread(value: number) {
    unread.value = Math.max(0, Number(value) || 0);
    lastFetchAt = Date.now();
}

/** 退出登录时清零，避免下一个账号看到上个账号的角标 */
function resetUnread() {
    unread.value = 0;
    lastFetchAt = 0;
}

export function useUnread() {
    return { unread, refresh, setUnread, resetUnread };
}
