import type { AgentSummary } from '@commons/contract';
import type { WorkConversationSummary, WorkSpace } from '../utils/work';

/**
 * 会话侧栏共享状态：布局、对话页和空间筛选消费同一份数据。
 *
 * `activeSpaceId` 为 null 表示「全部空间」；新建对话会把当前筛选空间带进 POST /api/conversations，
 * 聊天页的 transport 也带同一个 spaceId，于是服务端自动建会话时不会落回默认空间。
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
    const activeSpaceId = useState<string | null>('chat-active-space', () => null);
    /** `/chat` 的「新建对话」意图：为 true 时该页保持空白，不再自动落到最近一条会话 */
    const newChatRequested = useState<boolean>('chat-new-chat-requested', () => false);

    const agentIdParam = computed(() => (route.params.agentId as string | undefined) ?? null);
    const visibleConversations = computed(() => {
        const agentId = agentIdParam.value;
        const spaceId = activeSpaceId.value;
        return conversations.value.filter((conversation) => (!spaceId || conversation.spaceId === spaceId) && (!agentId || conversation.agentId === agentId));
    });

    /** `/chat` 未显式选择智能体时，跟随最近一条会话（没有历史则第一个智能体） */
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

    /** 切换空间筛选：当前会话若不在新空间里就复位成新对话，避免显示一段不属于该空间的历史。 */
    function selectSpace(spaceId: string | null) {
        activeSpaceId.value = spaceId;
        if (!activeConversationId.value) return;
        const current = conversations.value.find((conversation) => conversation.id === activeConversationId.value);
        if (current && spaceId && current.spaceId !== spaceId) {
            activeConversationId.value = null;
            newChatRequested.value = true;
        }
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
        activeSpaceId,
        newChatRequested,
        agentIdParam,
        visibleConversations,
        effectiveAgentId,
        effectiveConversationId,
        selectConversation,
        selectSpace,
        startNewChat,
    };
}
