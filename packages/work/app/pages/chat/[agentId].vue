<script setup lang="ts">
import type { AgentDetail } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 指定智能体的对话页（`/chat/:agentId`）：会话列表由布局左栏渲染（只列该智能体的会话），头部不提供智能体切换器。
 * 对话主体与 `/chat` 共用 ChatPane；`/chat` 多一个切换器，这里固定由路由参数决定。
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

/** 会话列表与选中态由布局左栏共享：这里只按 agentId 过滤后的可见列表 */
const { visibleConversations, activeConversationId, refreshConversations } = useChatSidebar();

/**
 * 深链 `?c=` 只在确实属于该智能体时才生效：否则会把别的智能体的会话挂到当前 agentId 的
 * transport 上续聊（服务端同样会用 400 拒绝，这里先在客户端挑掉，避免一次注定失败的请求）。
 */
function resolveInitialConversation(): string | null {
    const requested = route.query.c as string | undefined;
    if (requested && visibleConversations.value.some((c) => c.id === requested)) return requested;
    return visibleConversations.value[0]?.id ?? null;
}

const initialConversationId = resolveInitialConversation();
activeConversationId.value = initialConversationId;
/** 还等着自动选中该智能体的最近一条会话：用户主动选会话或开新对话后就不再自动跳 */
const autoSelectPending = ref(!initialConversationId);

watch(visibleConversations, (list) => {
    if (!autoSelectPending.value || !list.length) return;
    autoSelectPending.value = false;
    activeConversationId.value = list[0]!.id;
});

// 路由参数变化（同一页面组件被复用）：上一个智能体的会话不再适用，等新列表到达后自动选中最近一条
watch(agentId, () => {
    activeConversationId.value = null;
    autoSelectPending.value = true;
});

// SPA 跳转可以把 ?c= 换到另一条会话（组件不会重建）：同样只在它属于当前智能体时跟随
watch(
    () => route.query.c,
    (requested) => {
        if (typeof requested !== 'string' || !requested) return;
        if (!visibleConversations.value.some((c) => c.id === requested)) return;
        autoSelectPending.value = false;
        activeConversationId.value = requested;
    },
);

function onCreateConversation() {
    autoSelectPending.value = false;
    activeConversationId.value = null;
}

function onActiveConversationChange(id: string | null) {
    if (id) autoSelectPending.value = false;
    activeConversationId.value = id;
}

/** 窄屏历史入口：会话列表就在外壳抽屉里，直接开抽屉 */
const { open: openDrawer } = useShellDrawer();
</script>

<template>
    <div class="space-y-3">
        <!-- 智能体不存在或已停用：给出返回广场的出口，否则页面只剩一个空对话壳 -->
        <div v-if="agentError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ t('agents.notFound') }}</span>
            <NuxtLink to="/agents" class="app-btn app-btn-soft shrink-0 !py-1.5">{{ t('agents.title') }} →</NuxtLink>
        </div>

        <!-- dvh：移动浏览器地址栏收展时 100vh 大于可视高度，会把输入栏顶出屏幕。
             6.5rem = 窄屏顶栏 h-14(3.5rem) + 主区 py-6(3rem)；≥lg 顶栏隐藏，只剩 py-6 -->
        <div class="flex h-[calc(100dvh-6.5rem)] flex-col lg:h-[calc(100dvh-3rem)]">
            <ChatPane
                class="min-h-0 flex-1"
                :agent-id="agentId"
                :conversation-id="activeConversationId"
                :initial-agent="agentData"
                @update:conversation-id="onActiveConversationChange"
                @conversation-list-stale="refreshConversations()"
                @open-history="openDrawer = true"
            />
        </div>
    </div>
</template>
