<script setup lang="ts">
import type { AgentDetail, ConversationSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

/**
 * 指定智能体的对话页：侧栏只列该智能体的会话，头部不提供智能体切换器。
 * 对话主体与首页共用 ChatPane；首页多一个切换器，这里固定由路由参数决定。
 *
 * agentId 用 computed 包住 route.params：/chat/A 与 /chat/B 是同一个页面组件，
 * 直接解构出静态字符串会在路由参数变化后继续用旧值。
 */
const { t } = useI18n();
const route = useRoute();
const agentId = computed(() => route.params.agentId as string);

// 路由参数已被 vue-router 解码（%2F → /），必须重新编进单个路径段：
// 否则 /chat/x%2F..%2F..%2Fapi%2Fadmin%2Fstorage 这类深链会让页面带着登录凭证去请求用户没选过的路径
const { data: agentData, error: agentError } = await useFetch<AgentDetail>(() => `/api/agents/${encodeURIComponent(agentId.value)}`);
const {
    data: conversationListData,
    error: conversationListError,
    refresh: refreshConversations,
    pending: conversationsPending,
} = await useFetch<ConversationSummary[]>('/api/conversations', { query: { agentId } });

const conversations = computed(() => conversationListData.value ?? []);
const conversationError = computed(() => (conversationListError.value ? t('common.loadFailed') : ''));

/**
 * 深链 `?c=` 只在确实属于该智能体时才生效：否则会把别的智能体的会话挂到当前 agentId 的
 * transport 上续聊（服务端只校验会话归属，不校验 agent 是否匹配）。
 */
function resolveInitialConversation(): string | null {
    const requested = route.query.c as string | undefined;
    if (requested && conversations.value.some((c) => c.id === requested)) return requested;
    return conversations.value[0]?.id ?? null;
}

const initialConversationId = resolveInitialConversation();
const activeConversationId = ref<string | null>(initialConversationId);
/** 还等着自动选中该智能体的最近一条会话：用户主动选会话或开新对话后就不再自动跳 */
const autoSelectPending = ref(!initialConversationId);

watch(conversations, (list) => {
    if (!autoSelectPending.value || !list.length) return;
    autoSelectPending.value = false;
    activeConversationId.value = list[0]!.id;
});

// 路由参数变化（同一页面组件被复用）：上一个智能体的会话不再适用，等新列表到达后自动选中最近一条；
// 组件不卸载，移动端的历史抽屉要一并关掉，避免「新智能体 + 旧抽屉高亮」的中间态
watch(agentId, () => {
    activeConversationId.value = null;
    autoSelectPending.value = true;
    historyOpen.value = false;
});

// SPA 跳转可以把 ?c= 换到另一条会话（组件不会重建）：同样只在它属于当前智能体时跟随
watch(
    () => route.query.c,
    (requested) => {
        if (typeof requested !== 'string' || !requested) return;
        if (!conversations.value.some((c) => c.id === requested)) return;
        autoSelectPending.value = false;
        activeConversationId.value = requested;
    },
);

function onSelectConversation(payload: { id: string }) {
    autoSelectPending.value = false;
    activeConversationId.value = payload.id;
}

/* ---------------- 移动端会话历史抽屉 ----------------
 * 与 HomeChat 共用 ChatHistoryDrawer；open 由这里持有，useCloseDrawerOnWide 必须传 md 的 query。 */
const historyOpen = ref(false);
useCloseDrawerOnWide(historyOpen, '(min-width: 768px)');

function onCreateConversation() {
    autoSelectPending.value = false;
    activeConversationId.value = null;
}

function onActiveConversationChange(id: string | null) {
    if (id) autoSelectPending.value = false;
    activeConversationId.value = id;
}

function onConversationDeleted(id: string) {
    if (activeConversationId.value === id) {
        // 删掉的正是当前会话：切到剩下最近的一条，没有则回到全新对话
        activeConversationId.value = conversations.value.find((c) => c.id !== id)?.id ?? null;
    }
    refreshConversations();
}
</script>

<template>
    <div class="space-y-3">
        <!-- 智能体不存在或已停用：给出返回广场的出口，否则页面只剩一个空对话壳 -->
        <div v-if="agentError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ t('agents.notFound') }}</span>
            <NuxtLink to="/chat" class="app-btn app-btn-soft shrink-0 !py-1.5">{{ t('nav.agents') }} →</NuxtLink>
        </div>

        <!-- dvh：移动浏览器地址栏收展时 100vh 大于可视高度，会把输入栏顶出屏幕 -->
        <div class="flex h-[calc(100dvh-8.5rem)] gap-4">
            <ConversationList
                :conversations="conversations"
                :active-id="activeConversationId"
                :loading="conversationsPending"
                :error="conversationError"
                @select="onSelectConversation"
                @create="onCreateConversation"
                @changed="refreshConversations()"
                @deleted="onConversationDeleted"
            />

            <ChatPane
                :agent-id="agentId"
                :conversation-id="activeConversationId"
                :initial-agent="agentData"
                bulletin-position="chat"
                @update:conversation-id="onActiveConversationChange"
                @conversation-list-stale="refreshConversations()"
                @open-history="historyOpen = true"
            />
        </div>

        <!-- 移动端会话历史抽屉（< md）：只列当前智能体的会话，与桌面侧栏数据同源 -->
        <ChatHistoryDrawer
            :open="historyOpen"
            :conversations="conversations"
            :active-id="activeConversationId"
            :loading="conversationsPending"
            :error="conversationError"
            @close="historyOpen = false"
            @select="onSelectConversation"
            @create="onCreateConversation"
            @changed="refreshConversations()"
            @deleted="onConversationDeleted"
        />
    </div>
</template>
