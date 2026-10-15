<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 首页（`/`）：单一的对话主体；会话列表已上移到布局左栏（见 layouts/default.vue）。
 *
 * 与 `/chat/:agentId` 的差别只有一点：这里可以在对话头部切换智能体（agentList 传给 ChatPane），
 * 切换意味着开一段属于新智能体的对话。
 *
 * 选中态与会话数据都由 useChatSidebar 共享：布局左栏与本页读写同一份，不再各自拉取。
 */
const { t } = useI18n();

const { agents, conversations, activeAgentId, activeConversationId, homeBootstrapped, agentsError, refreshAgents, refreshConversations } =
    useChatSidebar();

const agentList = computed(() => agents.value ?? []);

/**
 * 默认选中最近一段对话（「上次聊到哪」的连续性）。布局 setup 已播种过一次；
 * 从智能体对话页直接进首页时布局不会重跑 setup，这里补一次。
 */
if (!homeBootstrapped.value) {
    homeBootstrapped.value = true;
    const latest = conversations.value[0] ?? null;
    activeAgentId.value = latest?.agentId ?? agentList.value[0]?.id ?? null;
    activeConversationId.value = latest?.id ?? null;
} else if (!activeAgentId.value) {
    activeAgentId.value = agentList.value[0]?.id ?? null;
}

/**
 * 选中态自检：从 `/chat/:agentId` 深链回到首页时，共享选中态可能属于别的智能体
 * （会话归属与当前智能体不一致）——复位成新对话，避免拿 A 的会话去续 B 的聊天。
 * activeConversationId 为 null 表示用户主动开了新对话，保持空白不动。
 */
const selected = conversations.value.find((c) => c.id === activeConversationId.value && c.agentId === activeAgentId.value);
if (activeConversationId.value && !selected) activeConversationId.value = null;

/** 换智能体：会话归属随之作废，回到全新对话（ChatPane 也会把自己的归属清空） */
function switchAgent(id: string) {
    if (id === activeAgentId.value) return;
    activeAgentId.value = id;
    activeConversationId.value = null;
}

function onActiveConversationChange(id: string | null) {
    activeConversationId.value = id;
}

function retry() {
    refreshAgents();
    refreshConversations();
}
</script>

<template>
    <div class="space-y-3">
        <div v-if="agentsError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ t('agents.loadFailedHint') }}</span>
            <button type="button" class="app-btn app-btn-soft shrink-0 !py-1.5" @click="retry">{{ t('common.retry') }}</button>
        </div>

        <!-- dvh：移动浏览器地址栏收展时 100vh 大于可视高度，会把输入栏顶出屏幕。
             6.5rem = 窄屏顶栏 h-14(3.5rem) + 主区 py-6(3rem)；≥lg 顶栏隐藏，只剩 py-6 -->
        <div class="flex h-[calc(100dvh-6.5rem)] flex-col lg:h-[calc(100dvh-3rem)]">
            <ChatPane
                class="min-h-0 flex-1"
                :agent-id="activeAgentId"
                :conversation-id="activeConversationId"
                :agent-list="agentList"
                @update:agent-id="switchAgent"
                @update:conversation-id="onActiveConversationChange"
                @conversation-list-stale="refreshConversations()"
            />
        </div>
    </div>
</template>
