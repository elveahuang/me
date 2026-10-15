import type { AgentSummary, ConversationSummary } from '@commons/contract';

/**
 * 会话侧栏共享状态：布局左栏（桌面）与抽屉（窄屏）渲染同一份会话列表，
 * 聊天页（首页 / /chat/:agentId）只消费、不再各自拉取，避免侧栏与页面两份数据、两套选中态。
 *
 * - 列表在布局里用 useAsyncData 拉（键固定，跨页共享同一份缓存）。
 *   不 await 是因为布局（layouts/default.vue）不支持 async setup。
 * - 只有 `/chat/:agentId` 会把列表收窄到该智能体；首页/广场/设置页显示全部会话。
 * - 选中态用 `effective*` 计算属性表达，而不是在 setup 里命令式播种：
 *   布局先于页面渲染，命令式播种读到的还是默认空数组，SSR 首屏会没有高亮。
 */
export function useChatSidebar() {
    const route = useRoute();

    const {
        data: agents,
        refresh: refreshAgents,
        error: agentsError,
    } = useAsyncData('chat-sidebar-agents', () => $fetch<AgentSummary[]>('/api/agents'), { default: () => [] });
    const {
        data: conversations,
        refresh: refreshConversations,
        pending: conversationsPending,
        error: conversationsError,
    } = useAsyncData('chat-sidebar-conversations', () => $fetch<ConversationSummary[]>('/api/conversations'), { default: () => [] });

    const activeAgentId = useState<string | null>('chat-active-agent', () => null);
    const activeConversationId = useState<string | null>('chat-active-conversation', () => null);
    /** 首页「新建对话」意图：为 true 时首页保持空白，不再自动落到最近一条会话 */
    const homeNewChat = useState<boolean>('chat-home-new-chat', () => false);

    const agentIdParam = computed(() => (route.params.agentId as string | undefined) ?? null);
    const visibleConversations = computed(() => {
        const id = agentIdParam.value;
        return id ? conversations.value.filter((c) => c.agentId === id) : conversations.value;
    });

    /** 首页未显式选择智能体时，跟随最近一条会话（没有历史则第一个智能体） */
    const effectiveAgentId = computed(() => {
        if (agentIdParam.value) return agentIdParam.value;
        if (activeAgentId.value) return activeAgentId.value;
        return visibleConversations.value[0]?.agentId ?? agents.value[0]?.id ?? null;
    });

    /**
     * 首页未显式选中（且不是新建对话）时，落在当前智能体最近一条会话上，
     * 保持「上次聊到哪」的连续性；对话页直接用页面持有的选中态。
     */
    const effectiveConversationId = computed(() => {
        if (agentIdParam.value) return activeConversationId.value;
        if (homeNewChat.value) return null;
        if (activeConversationId.value) return activeConversationId.value;
        return visibleConversations.value.find((c) => c.agentId === effectiveAgentId.value)?.id ?? null;
    });

    /** 侧栏点选会话：清掉「新建对话」意图，首页与对话页都切到该会话 */
    function selectConversation(agentId: string, id: string) {
        homeNewChat.value = false;
        activeAgentId.value = agentId;
        activeConversationId.value = id;
    }

    /** 新建对话：清掉选中态并标记意图，首页保持空白对话 */
    function startNewChat() {
        homeNewChat.value = true;
        activeConversationId.value = null;
    }

    return {
        agents,
        refreshAgents,
        agentsError,
        conversations,
        refreshConversations,
        conversationsPending,
        conversationsError,
        activeAgentId,
        activeConversationId,
        homeNewChat,
        agentIdParam,
        visibleConversations,
        effectiveAgentId,
        effectiveConversationId,
        selectConversation,
        startNewChat,
    };
}
