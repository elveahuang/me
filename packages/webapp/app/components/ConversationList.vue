<script setup lang="ts">
import { extractApiError, type ConversationSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 会话历史侧栏：首页（全部会话）与智能体对话页（该智能体的会话）共用。
 *
 * 组件是展示型 + 自身的重命名/删除动作，列表数据由父级持有（首页走 useFetch 享受 SSR，
 * 对话页按 agentId 客户端拉取）。删除与重命名成功后 emit('changed')，由父级决定怎么刷新。
 */
const props = withDefaults(
    defineProps<{
        conversations: ConversationSummary[];
        /** 当前打开的会话 id，用于高亮 */
        activeId?: string | null;
        loading?: boolean;
        /** 列表拉取失败的原因：与「没有会话」区分，避免用户把接口故障读成没数据 */
        error?: string;
        /** 列表项副信息是否显示所属智能体（首页列表跨智能体，需要） */
        showAgentName?: boolean;
        /**
         * 布局形态：sidebar 是桌面侧栏（< md 隐藏，父级需另配移动端抽屉入口）；
         * drawer 填满父级给的移动端抽屉容器（app-drawer 是 flex column，靠 flex-1 撑满）。
         */
        variant?: 'sidebar' | 'drawer';
    }>(),
    { activeId: null, loading: false, error: '', showAgentName: false, variant: 'sidebar' },
);

const emit = defineEmits<{
    select: [payload: { id: string; agentId: string }];
    create: [];
    /** 重命名成功：父级需要刷新列表 */
    changed: [];
    /** 删除成功：父级刷新列表；若删的正是当前打开的会话，还需切到下一个或复位 */
    deleted: [id: string];
}>();

const { t } = useI18n();
const route = useRoute();

/** 两种形态的根样式在此收口，避免调用方用外部 class 去跟 hidden/flex/w-64 打 cascade 优先级仗 */
const rootClass = computed(() =>
    props.variant === 'drawer' ? 'flex min-h-0 w-full flex-1 flex-col overflow-hidden' : 'app-card hidden w-64 shrink-0 flex-col overflow-hidden md:flex',
);

/** 首页是根路径，去智能体广场不叫「返回」：只有对话页才显示回退箭头 */
const backArrow = computed(() => (route.path === '/' ? '' : '← '));

const searchQuery = ref('');
const editingTitleId = ref<string | null>(null);
const editTitleInput = ref('');
/** 进入改名态时的原标题，用来认出「打开了但没改」 */
let editTitleOriginal = '';

/**
 * 改名广播：ChatPane 持有的会话标题是它自己的本地值（载入历史时取一次），
 * 侧栏的 PATCH 不会同步过去，于是改名后导出 Markdown 仍用旧标题当文档标题与文件名。
 * 组件是兄弟关系（侧栏与面板都由父级摆放，谁都不是谁的 parent），所以走共享状态而不是 props。
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

/** 改名/删除失败的就地提示：侧栏常驻，靠 showTransient 的超时自动清除 */
const { error: actionError, show: showActionError } = useTransientError();

async function saveRename(id: string) {
    // Enter 提交会把输入框整个卸载（editingTitleId 置空），而卸载焦点元素还会补发一次 blur，
    // 于是同一次改名发出两条一模一样的 PATCH——第二条还会再 emit('changed')，让父级并发重载会话列表。
    if (editingTitleId.value !== id) return;
    const newTitle = editTitleInput.value.trim();
    editingTitleId.value = null;
    /**
     * 文字没改动过就不发：只点了一下 ✎ 再点别处，同样会以原标题跑完这个函数，
     * 而 PATCH 无条件把 updatedAt 顶到当前时间、侧栏按它倒序排——
     * 一次什么都没改的操作会让那条会话凭空跳到列表最前面。
     */
    if (!newTitle || newTitle === editTitleOriginal) return;
    try {
        await $fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title: newTitle } });
        renamedConversation.value = { id, title: newTitle };
        emit('changed');
    } catch (e) {
        showActionError(extractApiError(e, t('common.error')));
    }
}

async function removeConversation(id: string) {
    if (!confirm(t('chat.deleteConfirm'))) return;
    try {
        await $fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        emit('deleted', id);
    } catch (e) {
        showActionError(extractApiError(e, t('common.error')));
    }
}
</script>

<template>
    <aside :class="rootClass">
        <div class="app-divider border-t-0 p-3">
            <NuxtLink to="/chat" class="text-muted-2 text-hover-brand flex items-center gap-1.5 text-xs font-semibold transition-colors">
                <span>{{ backArrow }}{{ t('nav.agents') }}</span>
            </NuxtLink>
        </div>
        <div class="p-3">
            <button class="app-btn app-btn-primary w-full" @click="emit('create')">+ {{ t('chat.newChat') }}</button>
        </div>

        <p v-if="showAgentName" class="app-sidebar-group-title">{{ t('chat.recentConversations') }}</p>

        <div class="px-2.5 pb-2">
            <input v-model="searchQuery" :placeholder="t('chat.searchChat')" :aria-label="t('chat.searchChat')" class="app-input !px-2.5 !py-1 !text-xs" />
        </div>

        <div v-if="error" class="app-alert app-alert-danger mx-2.5 mb-2 !text-[11px]">{{ error }}</div>
        <div v-if="actionError" class="app-alert app-alert-danger mx-2.5 mb-2 !text-[11px]">{{ actionError }}</div>

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
                        @click="emit('select', { id: c.id, agentId: c.agentId })"
                    >
                        {{ c.title }}
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
