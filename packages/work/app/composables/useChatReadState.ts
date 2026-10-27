/**
 * 会话「有新回复」标记的本机记录。
 *
 * 为什么只存在浏览器里：判据是「这台机器上，这个人最后看到这条会话时的 `updatedAt`」，
 * 它是阅读进度而不是数据本身——写进库就等于给一段本机展示状态加了迁移与清理成本，
 * 而 work 根本没有多端。
 *
 * 口径只有一条：`updatedAt` 与记录里的不同 = 没见过。服务端在回复收尾时才回填标题与 `updatedAt`，
 * 所以「后台那一轮跑完」天然会变未读。重命名同样会顶动 `updatedAt`，但用户此刻正在操作这条会话，
 * 布局在 `changed` 之后把它重新记为已读，于是列表不会因此亮起点。
 *
 * 与 R6 那条 12 秒浮层是互补关系：浮层负责「当场告诉你」，这个点负责「你没看见也不会漏」；
 * 浮层会自己消失，点要等你真的打开那条会话才清。
 */

const READ_KEY = 'work_conversation_read';

interface ReadStore {
    /** 首次使用时的整表播种标记：没有它，老用户一装上就看到满列表的未读点 */
    initialized: boolean;
    seen: Record<string, string>;
}

/** 模块级共享：侧栏与布局各调一次 composable，必须读到同一份状态 */
const store = ref<ReadStore | null>(null);

function emptyStore(): ReadStore {
    return { initialized: false, seen: {} };
}

/**
 * 解析存储值。
 *
 * `JSON.parse` 成功不代表形状可用：`null`、数字、数组、`seen` 里混进非字符串都可能是
 * 用户手改或旧版本留下的残骸，所以逐层收窄而不是直接当 `ReadStore` 用。
 */
function parseStore(raw: string | null): ReadStore {
    if (!raw) return emptyStore();
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return emptyStore();
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyStore();
    const candidate = value as { initialized?: unknown; seen?: unknown };
    const seen: Record<string, string> = {};
    if (candidate.seen && typeof candidate.seen === 'object' && !Array.isArray(candidate.seen)) {
        for (const [key, entry] of Object.entries(candidate.seen as Record<string, unknown>)) {
            if (typeof entry === 'string') seen[key] = entry;
        }
    }
    return { initialized: candidate.initialized === true, seen };
}

function readStore(): ReadStore {
    if (store.value) return store.value;
    const next = parseStore(localStorage.getItem(READ_KEY));
    store.value = next;
    return next;
}

function persist() {
    if (import.meta.server || !store.value) return;
    localStorage.setItem(READ_KEY, JSON.stringify(store.value));
}

export function useChatReadState() {
    /** 全新浏览器（没有记录）时把当前列表整体标为已读，之后才开始的更新才算未读 */
    function ensureSeeded(list: { id: string; updatedAt: string }[]) {
        if (import.meta.server) return;
        // 空列表不是播种时机：那一刻还分不清「这台机器没有历史」和「请求还在飞/刚失败」，
        // 播种成 {} 会让用户已有的每条会话都亮起未读点
        if (!list.length) return;
        const current = readStore();
        if (current.initialized) return;
        current.initialized = true;
        current.seen = Object.fromEntries(list.map((item) => [item.id, item.updatedAt]));
        persist();
    }

    function markRead(id: string, updatedAt: string) {
        if (import.meta.server) return;
        const current = readStore();
        if (current.seen[id] === updatedAt) return;
        current.seen[id] = updatedAt;
        persist();
    }

    function isUnread(conversation: { id: string; updatedAt: string }) {
        if (import.meta.server) return false;
        return readStore().seen[conversation.id] !== conversation.updatedAt;
    }

    /** 会话删掉后它的阅读记录没有意义了；不清理就会随对话数无界增长 */
    function forgetConversation(id: string) {
        if (import.meta.server) return;
        const current = readStore();
        if (!(id in current.seen)) return;
        delete current.seen[id];
        persist();
    }

    return { ensureSeeded, markRead, isUnread, forgetConversation };
}
