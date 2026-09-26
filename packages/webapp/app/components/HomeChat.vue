<script setup lang="ts">
import type { AgentSummary, ConversationSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 首页（`/`）：单一的对话主体 + 会话侧栏，与 `/chat` 的智能体广场完全不同。
 *
 * 与 `/chat/:agentId` 的差别只有一点：这里可以在对话头部切换智能体（agentList 传给 ChatPane），
 * 切换意味着开一段属于新智能体的对话。
 *
 * 数据：智能体清单与会话清单走 useFetch，SSR 即可拿到（同源请求自动带 cookie）；
 * 要打开哪一段会话在 setup 里就定好——会话历史本身只在客户端拉（见 ChatPane），
 * 在这里用 onMounted 定会先渲染一帧「未选择智能体」的空态再跳。
 */
const { t } = useI18n();

const { data: agentListData, error: agentListError, refresh: refreshAgents } = await useFetch<AgentSummary[]>('/api/agents');
const {
    data: conversationListData,
    error: conversationListError,
    refresh: refreshConversations,
    pending: conversationsPending,
} = await useFetch<ConversationSummary[]>('/api/conversations');

const agentList = computed(() => agentListData.value ?? []);
const conversations = computed(() => conversationListData.value ?? []);
/** 会话清单失败交给侧栏就地提示；智能体清单失败会挡住对话，单独在页首给出重试 */
const conversationError = computed(() => (conversationListError.value ? t('common.loadFailed') : ''));
const agentError = computed(() => (agentListError.value ? t('common.loadFailed') : ''));

/** 打开最近一段对话，保持「上次聊到哪」的连续性；没有历史就从第一个智能体开始 */
const latestConversation = conversations.value[0] ?? null;
const activeAgentId = ref<string | null>(latestConversation?.agentId ?? agentList.value[0]?.id ?? null);
const activeConversationId = ref<string | null>(latestConversation?.id ?? null);

// 首屏拿不到智能体（接口故障）后重试成功：此时才有可选对象，补上默认选择
watch(agentList, (list) => {
    if (!activeAgentId.value && list.length) activeAgentId.value = list[0]!.id;
});

function selectConversation(payload: { id: string; agentId: string }) {
    activeAgentId.value = payload.agentId;
    activeConversationId.value = payload.id;
}

/* ---------------- 移动端会话历史抽屉 ----------------
 * 会话侧栏（ConversationList）< md 隐藏，手机上由 ChatPane 头部的历史按钮打开 ChatHistoryDrawer。
 * open 由这里持有：useCloseDrawerOnWide 必须传 md 的 query（断点不是默认的 lg）。 */
const historyOpen = ref(false);
useCloseDrawerOnWide(historyOpen, '(min-width: 768px)');

/** 换智能体：会话归属随之作废，回到全新对话（ChatPane 也会把自己的归属清空） */
function switchAgent(id: string) {
    if (id === activeAgentId.value) return;
    activeAgentId.value = id;
    activeConversationId.value = null;
}

function onConversationDeleted(id: string) {
    if (activeConversationId.value === id) activeConversationId.value = null;
    refreshConversations();
}

function retry() {
    refreshAgents();
    refreshConversations();
}
</script>

<template>
    <div class="space-y-3">
        <!-- 首页位置宣传栏：放在页面顶部而不是对话卡片内，与落地页语义一致 -->
        <BulletinBanner position="home" />

        <div v-if="agentError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ t('agents.loadFailedHint') }}</span>
            <button type="button" class="app-btn app-btn-soft shrink-0 !py-1.5" @click="retry">{{ t('common.retry') }}</button>
        </div>

        <!-- dvh：移动浏览器地址栏收展时 100vh 大于可视高度，会把输入栏顶出屏幕 -->
        <div class="flex h-[calc(100dvh-8.5rem)] gap-4">
            <ConversationList
                :conversations="conversations"
                :active-id="activeConversationId"
                :loading="conversationsPending"
                :error="conversationError"
                show-agent-name
                @select="selectConversation"
                @create="activeConversationId = null"
                @changed="refreshConversations()"
                @deleted="onConversationDeleted"
            />

            <ChatPane
                :agent-id="activeAgentId"
                :conversation-id="activeConversationId"
                :agent-list="agentList"
                @update:agent-id="switchAgent"
                @update:conversation-id="(id: string | null) => (activeConversationId = id)"
                @conversation-list-stale="refreshConversations()"
                @open-history="historyOpen = true"
            />
        </div>

        <!-- 移动端会话历史抽屉（< md）：与桌面侧栏是两个实例，数据同源、搜索词各自独立 -->
        <ChatHistoryDrawer
            :open="historyOpen"
            :conversations="conversations"
            :active-id="activeConversationId"
            :loading="conversationsPending"
            :error="conversationError"
            show-agent-name
            @close="historyOpen = false"
            @select="selectConversation"
            @create="activeConversationId = null"
            @changed="refreshConversations()"
            @deleted="onConversationDeleted"
        />
    </div>
</template>
