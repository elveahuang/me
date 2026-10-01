<script setup lang="ts">
import type { ConversationSummary } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 移动端会话历史抽屉（< md 才渲染）：HomeChat 与 /chat/[agentId] 共用。
 *
 * 会话侧栏（ConversationList）窄屏下隐藏，本组件承载它的抽屉形态：
 * 遮罩点击 / Esc 关闭（useDrawerFocus 负责焦点圈闭、滚动锁与焦点归还），
 * 「视口跨过 md 变宽时自动关闭」由父级持有 open 状态并挂 useCloseDrawerOnWide。
 * 选中/新建会话后组件自行关闭——父级只需要处理业务侧的状态切换。
 */
const props = withDefaults(
    defineProps<{
        /** 开关由父级持有：父级需要在 open 上挂 useCloseDrawerOnWide 与路由 watch */
        open: boolean;
        conversations: ConversationSummary[];
        activeId?: string | null;
        loading?: boolean;
        error?: string;
        /** 首页列表跨智能体，需要显示每条会话所属的智能体 */
        showAgentName?: boolean;
    }>(),
    { activeId: null, loading: false, error: '', showAgentName: false },
);

const emit = defineEmits<{
    close: [];
    select: [payload: { id: string; agentId: string }];
    create: [];
    /** 重命名/删除成功：父级刷新会话清单 */
    changed: [];
    deleted: [id: string];
}>();

const { t } = useI18n();

const panel = ref<HTMLElement | null>(null);
useDrawerFocus(
    () => props.open,
    panel,
    () => emit('close'),
);

function onSelect(payload: { id: string; agentId: string }) {
    emit('select', payload);
    emit('close');
}

function onCreate() {
    emit('create');
    emit('close');
}
</script>

<template>
    <div v-if="open" class="md:hidden">
        <div class="app-drawer-backdrop" @click="emit('close')" />
        <aside ref="panel" class="app-drawer app-drawer-left safe-top safe-bottom" role="dialog" aria-modal="true" :aria-label="t('chat.recentConversations')">
            <div class="flex items-center justify-between border-b px-4 py-3" style="border-color: var(--line)">
                <span class="text-sm font-bold">{{ t('chat.recentConversations') }}</span>
                <button type="button" data-drawer-close class="app-btn app-btn-ghost app-btn-icon" :aria-label="t('common.close')" @click="emit('close')">
                    <AppIcon name="close" :size="18" />
                </button>
            </div>
            <ConversationList
                variant="drawer"
                :conversations="conversations"
                :active-id="activeId"
                :loading="loading"
                :error="error"
                :show-agent-name="showAgentName"
                @select="onSelect"
                @create="onCreate"
                @changed="emit('changed')"
                @deleted="(id: string) => emit('deleted', id)"
            />
        </aside>
    </div>
</template>
