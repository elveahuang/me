<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 对话（`/chat`）：工作台唯一的对话入口，会话列表由布局左栏渲染（见 layouts/default.vue）。
 *
 * 与 `/chat/:agentId` 的差别只有一点：这里可以在对话头部切换智能体（agentList 传给 ChatPane），
 * 切换意味着开一段属于新智能体的对话。`/` 是只做 302 的空壳，对话一律从这里进。
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
    spaces,
    newChatRequested,
    agentsError,
    refreshAgents,
    refreshConversations,
} = useChatSidebar();

const agentList = computed(() => agents.value ?? []);
/** 当前会话标题：ChatPane 接管在途实例时不回源历史，导出用的标题由这里补上 */
const activeConversation = computed(() => conversations.value.find((c) => c.id === effectiveConversationId.value) ?? null);
const activeConversationTitle = computed(() => activeConversation.value?.title ?? null);
const route = useRoute();
const router = useRouter();
const requestedSpaceId = computed(() => (typeof route.query.space === 'string' && route.query.space ? route.query.space : null));
const chatSpaceId = computed(() => (effectiveConversationId.value ? (activeConversation.value?.spaceId ?? null) : requestedSpaceId.value));
const chatSpaceName = computed(() => activeConversation.value?.spaceName ?? spaces.value.find((space) => space.id === chatSpaceId.value)?.name ?? null);

/**
 * `?c=` 是 URL 里的「当前会话」。
 *
 * 本页原先完全不认它：从侧栏或完成提示带着 `?c=` 落到 `/chat` 时会被忽略、回落到最近的会话；
 * 刷新也没法保留选中的那一条。现在列表到货后按 id 认人（连同它所属的智能体一起切），
 * 会话变化时再由 `onActiveConversationChange` 写回 URL。
 */
const requestedConversationId = computed(() => (typeof route.query.c === 'string' && route.query.c ? route.query.c : null));

watch(
    [conversations, requestedConversationId],
    ([list, requested]) => {
        if (!requested) return;
        const hit = list.find((c) => c.id === requested);
        if (!hit) return;
        newChatRequested.value = false;
        activeAgentId.value = hit.agentId;
        activeConversationId.value = hit.id;
    },
    { immediate: true },
);

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

/**
 * 会话变化（含 ChatPane 首次发送建出会话、点「＋」）同步到 URL，并维护「新对话」意图。
 *
 * `id === null` 来自头部的「＋」：必须同时记下 newChatRequested，否则 `effectiveConversationId`
 * 立刻回落到该智能体的最近一条，ChatPane 收到的 conversationId 与切换前一样，按钮看起来没反应。
 * 新对话还要摘掉 `?c=`，否则刷新会跳回刚离开的那条会话。
 */
function onActiveConversationChange(id: string | null) {
    activeConversationId.value = id;
    newChatRequested.value = id === null;
    if (((route.query.c as string | undefined) ?? null) === id) return;
    const query = { ...route.query };
    if (id) query.c = id;
    else delete query.c;
    void router.replace({ query });
}

function retry() {
    refreshAgents();
    refreshConversations();
}

/**
 * `?ask=` 带过来的草稿：把文本交给 ChatPane 填入输入框，随后清掉查询串。
 * 不直接发送——草稿要让用户改，而且长正文进输入框后还得看排版；
 * 清 URL 是为了刷新不会把同一段草稿再填一次（盖掉用户已经敲进去的东西）。
 */
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
                :conversation-title="activeConversationTitle"
                :agent-list="agentList"
                :space-id="chatSpaceId"
                :space-name="chatSpaceName"
                :draft="askDraft"
                @update:agent-id="switchAgent"
                @update:conversation-id="onActiveConversationChange"
                @conversation-list-stale="refreshConversations()"
                @open-history="openDrawer = true"
            />
        </div>
    </div>
</template>
