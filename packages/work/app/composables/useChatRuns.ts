import type { Chat } from '@ai-sdk/vue';
import type { UIMessage } from 'ai';

/**
 * 在途生成的实例登记表。
 *
 * 为什么放在模块级而不是组件里：「切页面 / 切会话不该打断生成」要求 Chat 实例活过 ChatPane 的销毁。
 * 实例只被组件的 `shallowRef` 持有时，卸载后它没有任何强引用，GC 之后连「这一轮跑到哪了」都无处可寻，
 * 回到原会话只能重新拉历史——而历史里那条 assistant 消息要等 `onFinish` 落库才存在，中间几十秒是空的。
 * 这里持住引用，回到同一段会话时直接接管：状态、在途分片、已渲染的正文都还在。
 *
 * 只在客户端写：服务端渲染时模块是跨请求共享的，`import.meta.server` 早退避免把实例漏进别的请求。
 */
const instances = new Map<string, Chat<UIMessage>>();
const statusStops = new Map<string, () => void>();

/**
 * 注册表容量上限。
 *
 * 每个 Chat 实例都攥着整段会话的 `parts`（工具输出可能是几十 KB 的 JSON），而工作台是常驻桌面应用：
 * 一天点开几十段会话、来回切，就会把这些历史全留在内存里。超出后按「最久没被碰过」淘汰，
 * 被丢出去的实例只是回到原会话时要重新拉一次历史——正在生成的那一轮永远不淘汰，
 * 那是这个登记表存在的理由。
 */
const INSTANCE_LIMIT = 12;

/** touch 一次：把这段会话挪到 Map 尾部（Map 保持插入顺序，尾部即最近使用），超出上限就从头淘汰 */
function touch(conversationId: string, chat: Chat<UIMessage>) {
    instances.delete(conversationId);
    instances.set(conversationId, chat);
    if (instances.size <= INSTANCE_LIMIT) return;
    for (const [id, held] of instances) {
        if (instances.size <= INSTANCE_LIMIT) break;
        // 正在生成的那条不能丢：丢掉引用等于没人再读那条流，这一轮的界面就永远停在半截
        if (isBusy(held.status)) continue;
        releaseChatRun(id);
    }
}

/** 服务端仍在生成的会话 id：刷新页面后本地一个实例都没有，只能问 `/api/chat/runs` */
const remoteRunningIds = ref<string[]>([]);
/** 本地持有实例且状态非 ready 的会话 id */
const localRunningIds = ref<string[]>([]);

/** 探测服务端在途轮次的节奏：只在确实拿到过在途 id 时才继续跑，空闲时一条请求都不发 */
const REMOTE_POLL_MS = 5000;
let remoteTimer: ReturnType<typeof setInterval> | null = null;
let remoteFetching = false;

function isBusy(status: string) {
    return status === 'streaming' || status === 'submitted';
}

function syncLocalRunning() {
    const next: string[] = [];
    for (const [id, chat] of instances) {
        if (isBusy(chat.status)) next.push(id);
    }
    localRunningIds.value = next;
}

function stopRemotePolling() {
    if (!remoteTimer) return;
    clearInterval(remoteTimer);
    remoteTimer = null;
}

async function probeRemoteRuns() {
    if (remoteFetching) return;
    remoteFetching = true;
    try {
        const res = await $fetch<{ ids: string[] }>('/api/chat/runs');
        remoteRunningIds.value = Array.isArray(res?.ids) ? res.ids : [];
    } catch {
        // 探测失败只是少一批角标，不打断界面；下一轮再试
        remoteRunningIds.value = [];
    } finally {
        remoteFetching = false;
        if (remoteRunningIds.value.length === 0 && !localRunningIds.value.length) stopRemotePolling();
    }
}

/** 登记实例并开始跟踪它的状态；同一会话换实例（重建历史）时直接覆盖旧引用 */
export function registerChatRun(conversationId: string, chat: Chat<UIMessage>) {
    if (import.meta.server) return;
    const previous = instances.get(conversationId);
    if (previous && previous !== chat) {
        statusStops.get(conversationId)?.();
        statusStops.delete(conversationId);
    }
    if (!statusStops.has(conversationId)) {
        statusStops.set(
            conversationId,
            watch(() => chat.status, syncLocalRunning, { flush: 'sync' }),
        );
    }
    // 放在状态订阅之后：淘汰别人时不能把刚登记这一条也顺手淘汰掉
    touch(conversationId, chat);
    syncLocalRunning();
    // 手里还有活时保持轮询：让「用户没在看的那条会话」跑完后角标自己消失
    if (localRunningIds.value.length || remoteRunningIds.value.length) {
        if (!remoteTimer) remoteTimer = setInterval(probeRemoteRuns, REMOTE_POLL_MS);
    }
}

/** 取回仍在内存里的那段会话实例；没有则 null，调用方按「新建」处理 */
export function adoptChatRun(conversationId: string): Chat<UIMessage> | null {
    if (import.meta.server) return null;
    const chat = instances.get(conversationId) ?? null;
    // 被 adopt 过就是「最近用过」，否则它会排在淘汰队列前面
    if (chat) touch(conversationId, chat);
    return chat;
}

/** 只丢引用、不打断生成：用于「这段会话我不再持有」但生成还在跑的情况 */
export function releaseChatRun(conversationId: string) {
    if (!instances.delete(conversationId)) return;
    statusStops.get(conversationId)?.();
    statusStops.delete(conversationId);
    syncLocalRunning();
}

/** 真正结束这一轮：会话被删除时既要丢实例，也要掐掉客户端在途的流 */
export function cancelChatRun(conversationId: string) {
    instances.get(conversationId)?.stop();
    releaseChatRun(conversationId);
}

/**
 * 用户按「停止」：本地实例与服务端那一轮都要停下。
 *
 * 只调 `chat.stop()` 是不够的——它断开的是浏览器这条 fetch，服务端仍会把模型读完并落库
 * （后台续跑靠的正是这一点）。所以这里另发一次 stop 请求，让那一轮真的中断；
 * 已产出的部分回复由服务端 `onFinish` 保存，界面保留屏幕上的内容。
 */
export async function stopChatRun(conversationId: string) {
    if (import.meta.server) return;
    instances.get(conversationId)?.stop();
    try {
        await $fetch(`/api/chat/${encodeURIComponent(conversationId)}/stop`, { method: 'POST' });
    } catch {
        // 这一轮可能刚好自己跑完了；该停的已经停了，不再打扰用户
    }
}

/** 侧栏角标口径：本地实例 ∪ 服务端在途（去掉本地已知的，避免同一条会话出现两套判定） */
export function useChatRuns() {
    const runningIds = computed(() => {
        const ids = new Set(localRunningIds.value);
        for (const id of remoteRunningIds.value) ids.add(id);
        return [...ids];
    });

    function isRunning(conversationId: string) {
        return runningIds.value.includes(conversationId);
    }

    /** 侧栏挂载时探一次：有在途轮次才留下轮询，没有就一条请求用完即走 */
    function refreshRemoteRuns() {
        if (import.meta.server) return;
        void probeRemoteRuns();
        if (remoteRunningIds.value.length && !remoteTimer) remoteTimer = setInterval(probeRemoteRuns, REMOTE_POLL_MS);
    }

    return { runningIds, isRunning, refreshRemoteRuns };
}
