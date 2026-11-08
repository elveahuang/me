<script setup lang="ts">
import type { ConversationSummary } from '@commons/contract';

/**
 * 对话页的「桌面侧栏 + 对话主体 + 移动抽屉」三件套装配（HomeChat 与 `/chat/:agentId` 共用）。
 *
 * 此前两个页面各抄一遍：同一段 `useCloseDrawerOnWide(historyOpen, '(min-width: 768px)')`、
 * 同一组 ConversationList / ChatHistoryDrawer 事件转发。抽屉断点是 md 不是 lg——这段脚手架
 * 集中一处后，新配会话侧栏的对话页不再有机会漏掉那个 query。
 *
 * 对话主体（ChatPane）经默认 slot 注入：两个页面的 props/事件差异很大（首页可切智能体、
 * 固定页有 `?c=` 深链），强行参数化只会把差异藏进回调里。
 */
const props = defineProps<{
    conversations: ConversationSummary[];
    activeConversationId?: string | null;
    conversationsPending?: boolean;
    /** 列表拉取失败的原因：与「没有会话」区分，避免把接口故障读成没数据 */
    conversationError?: string;
    /** 列表项副信息是否显示所属智能体（首页列表跨智能体，需要；固定智能体页不需要） */
    showAgentName?: boolean;
}>();

const emit = defineEmits<{
    select: [payload: { id: string; agentId: string }];
    create: [];
    /** 会话重命名/增删后父级刷新列表 */
    changed: [];
    deleted: [id: string];
}>();

/* ---------------- 移动端会话历史抽屉 ----------------
 * 会话侧栏（ConversationList）< md 隐藏，手机上由 ChatPane 头部的历史按钮打开 ChatHistoryDrawer。
 * open 在这里持有：useCloseDrawerOnWide 必须传 md 的 query（断点不是默认的 lg）。
 * 选中/新建后抽屉自行 emit close，不需要这里干预。 */
const historyOpen = ref(false);
useCloseDrawerOnWide(historyOpen, '(min-width: 768px)');

/** 路由参数变化等「换一批会话」的时机由页面调用：抽屉里还挂着旧智能体的高亮时一并关掉 */
function closeHistory() {
    historyOpen.value = false;
}

/** ChatPane 头部历史按钮的入口（open 状态收在本组件内，页面经 ref 中继） */
function openHistory() {
    historyOpen.value = true;
}
defineExpose({ closeHistory, openHistory });
</script>

<template>
    <!-- dvh：移动浏览器地址栏收展时 100vh 大于可视高度，会把输入栏顶出屏幕 -->
    <div class="flex h-[calc(100dvh-8.5rem)] gap-4">
        <ConversationList
            :conversations="props.conversations"
            :active-id="props.activeConversationId"
            :loading="props.conversationsPending"
            :error="props.conversationError"
            :show-agent-name="props.showAgentName"
            @select="(payload) => emit('select', payload)"
            @create="emit('create')"
            @changed="emit('changed')"
            @deleted="(id) => emit('deleted', id)"
        />

        <slot />

        <!-- 移动端会话历史抽屉（< md）：与桌面侧栏是两个实例，数据同源、搜索词各自独立 -->
        <ChatHistoryDrawer
            :open="historyOpen"
            :conversations="props.conversations"
            :active-id="props.activeConversationId"
            :loading="props.conversationsPending"
            :error="props.conversationError"
            :show-agent-name="props.showAgentName"
            @close="historyOpen = false"
            @select="(payload) => emit('select', payload)"
            @create="emit('create')"
            @changed="emit('changed')"
            @deleted="(id) => emit('deleted', id)"
        />
    </div>
</template>
