<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 对话（`/chat`）：工作台唯一的对话入口，会话列表由布局左栏渲染（见 layouts/default.vue）。
 *
 * 与 `/chat/:agentId` 的差别只有一点：这里可以在对话头部切换智能体（agentList 传给 ChatPane），
 * 切换意味着开一段属于新智能体的对话。`/` 是今日总览，不再承载对话。
 *
 * 选中态与会话数据都由 useChatSidebar 共享：布局左栏与本页读写同一份，不再各自拉取。
 * 传给 ChatPane 的是 `effective*` 计算属性而不是 `active*` ref：布局先于页面渲染，
 * 命令式播种读到的还是默认空数组，SSR 首屏会没有高亮。
 */
const { t } = useI18n();

const {
    agents,
    conversations,
    effectiveAgentId,
    effectiveConversationId,
    activeAgentId,
    activeConversationId,
    agentsError,
    refreshAgents,
    refreshConversations,
} = useChatSidebar();

const agentList = computed(() => agents.value ?? []);

/**
 * 选中态自检：从 `/chat/:agentId` 深链回到本页时，共享选中态可能属于别的智能体
 * （会话归属与当前智能体不一致）——复位成新对话，避免拿 A 的会话去续 B 的聊天。
 * activeConversationId 为 null 表示用户主动开了新对话，保持空白不动。
 */
const selected = conversations.value.find((c) => c.id === activeConversationId.value && c.agentId === effectiveAgentId.value);
if (activeConversationId.value && !selected) activeConversationId.value = null;

/** 换智能体：会话归属随之作废，回到全新对话（ChatPane 也会把自己的归属清空） */
function switchAgent(id: string) {
    if (id === effectiveAgentId.value) return;
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

/**
 * 笔记页「问问 AI」带过来的 `?ask=`：把文本交给 ChatPane 填入输入框，随后清掉查询串。
 * 不直接发送——草稿要让用户改，而且长正文进输入框后还得看排版；
 * 清 URL 是为了刷新不会把同一段草稿再填一次（盖掉用户已经敲进去的东西）。
 */
const route = useRoute();
const router = useRouter();
const askDraft = ref(typeof route.query.ask === 'string' ? route.query.ask.slice(0, 4000) : '');

onMounted(() => {
    if (!askDraft.value) return;
    void router.replace({ query: { ...route.query, ask: undefined } });
});

/** 窄屏的历史入口：会话列表收在外壳抽屉里，抽屉只在对话面展开，所以本页要接住这个事件 */
const { open: openDrawer } = useShellDrawer();
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
                :agent-id="effectiveAgentId"
                :conversation-id="effectiveConversationId"
                :agent-list="agentList"
                :draft="askDraft"
                @update:agent-id="switchAgent"
                @update:conversation-id="onActiveConversationChange"
                @conversation-list-stale="refreshConversations()"
                @open-history="openDrawer = true"
            />
        </div>
    </div>
</template>
