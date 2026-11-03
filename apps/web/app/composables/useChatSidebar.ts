import type { AgentSummary } from '@commons/contract';
import type { WorkConversationSummary, WorkSpace } from '../utils/work';

/**
 * 侧栏共享状态：全局最近对话 + 空间列表。
 *
 * 空间不再是全局筛选器。对话是否属于空间由 `conversation.spaceId` 决定；
 * 首页、运行记录和资料库默认展示全局数据，空间页面自己按路由参数筛选。
 */
export function useChatSidebar() {
    const route = useRoute();

    const {
        data: agents,
        refresh: refreshAgents,
        error: agentsError,
    } = useAsyncData('chat-sidebar-agents', () => $fetch<AgentSummary[]>('/api/agents'), { default: () => [] });

    const {
        data: spaces,
        refresh: refreshSpaces,
        error: spacesError,
    } = useAsyncData('chat-sidebar-spaces', () => $fetch<WorkSpace[]>('/api/spaces'), { default: () => [] });

    const {
        data: conversations,
        refresh: refreshConversations,
        pending: conversationsPending,
        error: conversationsError,
    } = useAsyncData('chat-sidebar-conversations', () => $fetch<WorkConversationSummary[]>('/api/conversations'), { default: () => [] });

    const activeAgentId = useState<string | null>('chat-active-agent', () => null);
    const activeConversationId = useState<string | null>('chat-active-conversation', () => null);
    const newChatRequested = useState<boolean>('chat-new-chat-requested', () => false);

    const agentIdParam = computed(() => (route.params.agentId as string | undefined) ?? null);
    const visibleConversations = computed(() => {
        const agentId = agentIdParam.value;
        return conversations.value.filter((conversation) => !agentId || conversation.agentId === agentId);
    });

    const effectiveAgentId = computed(() => {
        if (agentIdParam.value) return agentIdParam.value;
        if (activeAgentId.value) return activeAgentId.value;
        return visibleConversations.value[0]?.agentId ?? agents.value[0]?.id ?? null;
    });

    const effectiveConversationId = computed(() => {
        if (agentIdParam.value) return activeConversationId.value;
        if (newChatRequested.value) return null;
        if (activeConversationId.value) return activeConversationId.value;
        return visibleConversations.value.find((conversation) => conversation.agentId === effectiveAgentId.value)?.id ?? null;
    });

    function selectConversation(agentId: string, id: string) {
        newChatRequested.value = false;
        activeAgentId.value = agentId;
        activeConversationId.value = id;
    }

    function startNewChat() {
        newChatRequested.value = true;
        activeConversationId.value = null;
    }

    return {
        agents,
        refreshAgents,
        agentsError,
        spaces,
        refreshSpaces,
        spacesError,
        conversations,
        refreshConversations,
        conversationsPending,
        conversationsError,
        activeAgentId,
        activeConversationId,
        newChatRequested,
        agentIdParam,
        visibleConversations,
        effectiveAgentId,
        effectiveConversationId,
        selectConversation,
        startNewChat,
    };
}
