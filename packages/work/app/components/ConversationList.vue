<script setup lang="ts">
import { extractApiError, type ConversationSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 会话历史区：布局左栏（桌面）与抽屉（窄屏）的「中间」区块。
 *
 * 组件是展示型 + 自身的重命名/删除动作，列表数据由 `useChatSidebar` 共享状态提供
 * （布局拉取、页面消费），删除与重命名成功后 emit('changed'|'deleted', id)，由布局统一刷新。
 *
 * 「新建对话」不在这里：它是「开始一件事」，与今日/定时任务/笔记同级，所以由布局的工作台段持有，
 * 本组件只负责历史本身（三段式布局的中段）。
 */
const props = withDefaults(
    defineProps<{
        conversations: ConversationSummary[];
        /** 当前打开的会话 id，用于高亮 */
        activeId?: string | null;
        loading?: boolean;
        /** 列表拉取失败的原因：与「没有会话」区分，避免用户把接口故障读成没数据 */
        error?: string;
        /** 列表项副信息是否显示所属智能体（跨智能体的列表需要） */
        showAgentName?: boolean;
    }>(),
    { activeId: null, loading: false, error: '', showAgentName: true },
);

const emit = defineEmits<{
    select: [payload: { id: string; agentId: string }];
    /** 重命名成功：布局需要刷新列表（带着 id，好把这条重新记为已读） */
    changed: [id: string];
    /** 删除成功：布局刷新列表；若删的正是当前打开的会话，还需切到下一个或复位 */
    deleted: [id: string];
}>();

const { t } = useI18n();

const searchQuery = ref('');
const editingTitleId = ref<string | null>(null);
const editTitleInput = ref('');
/** 进入改名态时的原标题，用来认出「打开了但没改」 */
let editTitleOriginal = '';

/**
 * 改名广播：ChatPane 持有的会话标题是它自己的本地值（载入历史时取一次），
 * 列表的 PATCH 不会同步过去，于是改名后导出 Markdown 仍用旧标题当文档标题与文件名。
 * 组件是兄弟关系（列表与面板都由布局/页面摆放，谁都不是谁的 parent），所以走共享状态而不是 props。
 */
const renamedConversation = useState<{ id: string; title: string } | null>('conversation-renamed', () => null);

const filteredConversations = computed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return props.conversations;
    return props.conversations.filter((c) => c.title.toLowerCase().includes(q));
});

function startRename(c: ConversationSummary) {
    editingTitleId.value = c.id;
    editTitleInput.value = c.title;
    editTitleOriginal = c.title;
}

/** 改名/删除失败的就地提示：列表常驻，靠 showTransient 的超时自动清除 */
const { error: actionError, show: showActionError } = useTransientError();

/** 后台仍在生成的会话：列表项前挂一个呼吸点，用户离开这一轮也认得它跑到哪段了 */
const { isRunning } = useChatRuns();
/** 有回复但还没看过：完成浮层只停 12 秒，没赶上的人靠这个点，打开会话即清除 */
const { isUnread } = useChatReadState();

async function saveRename(id: string) {
    // Enter 提交会把输入框整个卸载（editingTitleId 置空），而卸载焦点元素还会补发一次 blur，
    // 于是同一次改名发出两条一模一样的 PATCH——第二条还会再 emit('changed')，让布局并发重载会话列表。
    if (editingTitleId.value !== id) return;
    const newTitle = editTitleInput.value.trim();
    editingTitleId.value = null;
    /**
     * 文字没改动过就不发：只点了一下 ✎ 再点别处，同样会以原标题跑完这个函数，
     * 而 PATCH 无条件把 updatedAt 顶到当前时间、列表按它倒序排——
     * 一次什么都没改的操作会让那条会话凭空跳到列表最前面。
     */
    if (!newTitle || newTitle === editTitleOriginal) return;
    try {
        await $fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title: newTitle } });
        renamedConversation.value = { id, title: newTitle };
        emit('changed', id);
    } catch (e) {
        showActionError(extractApiError(e, t('common.error')));
    }
}

async function removeConversation(id: string) {
    if (!confirm(t('chat.deleteConfirm'))) return;
    try {
        await $fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        // 会话已经不存在，持有它的那一轮（可能正在后台生成）必须一起掐掉：
        // 留着实例会让角标一直亮着，回到这段会话也只会拿到一条已删历史的回放。
        cancelChatRun(id);
        emit('deleted', id);
    } catch (e) {
        showActionError(extractApiError(e, t('common.error')));
    }
}
</script>

<template>
    <aside class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <p class="app-sidebar-group-title shrink-0 pt-3">{{ t('chat.recentConversations') }}</p>

        <div class="shrink-0 px-2.5 pb-2">
            <input v-model="searchQuery" :placeholder="t('chat.searchChat')" :aria-label="t('chat.searchChat')" class="app-input !px-2.5 !py-1 !text-xs" />
        </div>

        <div v-if="error" class="app-alert app-alert-danger mx-2.5 mb-2 shrink-0 !text-[11px]">{{ error }}</div>
        <div v-if="actionError" class="app-alert app-alert-danger mx-2.5 mb-2 shrink-0 !text-[11px]">{{ actionError }}</div>

        <ul class="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            <li v-if="loading" class="space-y-1.5">
                <div v-for="n in 4" :key="n" class="app-skeleton h-9 !rounded-xl" />
            </li>

            <li v-for="c in filteredConversations" :key="c.id" class="group relative flex items-center">
                <template v-if="editingTitleId === c.id">
                    <input
                        v-model="editTitleInput"
                        :aria-label="t('chat.renameChat')"
                        class="app-input !px-2.5 !py-1.5 !text-xs"
                        @keyup.enter="saveRename(c.id)"
                        @blur="saveRename(c.id)"
                        @vue:mounted="(vnode: any) => vnode.el.focus()"
                    />
                </template>
                <template v-else>
                    <button
                        :class="[
                            'w-full truncate rounded-xl px-3 py-2 pr-14 text-left text-xs transition-colors',
                            c.id === activeId ? 'bg-brand-soft font-semibold' : 'text-soft hover:bg-[color:var(--surface-3)]',
                        ]"
                        :title="c.title"
                        :aria-current="c.id === activeId ? 'true' : undefined"
                        @click="emit('select', { id: c.id, agentId: c.agentId })"
                    >
                        <span class="flex items-center gap-1.5">
                            <span
                                v-if="isRunning(c.id)"
                                class="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[color:var(--warning)]"
                                :title="t('chat.runningInBackground')"
                            />
                            <span
                                v-else-if="isUnread(c)"
                                class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--brand-500)]"
                                :title="t('chat.unreadReply')"
                            />
                            <span class="truncate" :class="isUnread(c) && !isRunning(c.id) ? 'font-semibold' : ''">{{ c.title }}</span>
                        </span>
                        <span v-if="showAgentName" class="text-faint mt-0.5 block truncate text-[10px]">{{ c.agentName }}</span>
                    </button>
                    <div class="app-hover-reveal absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
                        <button
                            type="button"
                            class="text-faint text-hover-brand rounded p-2 transition-colors"
                            :title="t('chat.renameChat')"
                            :aria-label="t('chat.renameChat')"
                            @click.stop="startRename(c)"
                        >
                            ✎
                        </button>
                        <button
                            type="button"
                            class="text-faint text-hover-danger rounded p-2 transition-colors"
                            :title="t('chat.deleteChat')"
                            :aria-label="t('chat.deleteChat')"
                            @click.stop="removeConversation(c.id)"
                        >
                            🗑
                        </button>
                    </div>
                </template>
            </li>

            <li v-if="!filteredConversations.length && !loading && !error" class="text-faint px-3 py-4 text-center text-xs">
                {{ searchQuery ? t('admin.noData') : t('chat.noMessages') }}
            </li>
        </ul>
    </aside>
</template>
