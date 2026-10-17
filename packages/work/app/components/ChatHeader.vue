<script setup lang="ts">
import { useI18n } from 'vue-i18n';

withDefaults(
    defineProps<{
        agentEmoji: string;
        agentName: string;
        description?: string;
        model?: string | null;
        temperature?: number | null;
        toolCount?: number;
        skillCount?: number;
        knowledgeCount?: number;
        mcpCount?: number;
        switchable?: boolean;
        hasMessages?: boolean;
    }>(),
    {
        description: '',
        model: null,
        temperature: null,
        toolCount: 0,
        skillCount: 0,
        knowledgeCount: 0,
        mcpCount: 0,
        switchable: false,
        hasMessages: false,
    },
);

const emit = defineEmits<{
    'open-history': [];
    'open-agent-picker': [];
    export: [];
    'new-chat': [];
}>();

const { t } = useI18n();
</script>

<template>
    <div class="flex items-center justify-between gap-2 px-4 py-3" style="border-bottom: 1px solid var(--line); background-color: var(--surface-2)">
        <div class="flex min-w-0 items-center gap-3">
            <!-- 移动端会话历史入口：侧栏 < md 隐藏，抽屉由父级摆放。
                 按钮外层包 md:hidden 容器而非在 .app-btn 上加变体：
                 主题 CSS 未分层，.app-btn 的 display 会压掉 utilities 层的 md:hidden。 -->
            <div class="md:hidden">
                <button
                    type="button"
                    class="app-btn app-btn-ghost app-btn-icon"
                    :title="t('chat.recentConversations')"
                    :aria-label="t('chat.recentConversations')"
                    @click="emit('open-history')"
                >
                    <AppIcon name="menu" :size="18" />
                </button>
            </div>
            <button
                v-if="switchable"
                type="button"
                class="app-avatar-icon h-10 w-10 shrink-0 text-xl"
                :title="t('chat.switchAgent')"
                :aria-label="t('chat.switchAgent')"
                @click="emit('open-agent-picker')"
            >
                {{ agentEmoji }}
            </button>
            <div v-else class="app-avatar-icon h-10 w-10 shrink-0 text-xl">{{ agentEmoji }}</div>

            <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                    <button
                        v-if="switchable"
                        type="button"
                        class="text-hover-brand flex min-w-0 items-center gap-1 text-sm font-bold transition-colors"
                        :title="t('chat.switchAgent')"
                        @click="emit('open-agent-picker')"
                    >
                        <span class="truncate">{{ agentName }}</span>
                        <AppIcon name="chevron-down" :size="15" class="shrink-0" />
                    </button>
                    <h2 v-else class="truncate text-sm font-bold">{{ agentName }}</h2>

                    <span v-if="model" class="app-chip font-mono">{{ model }}</span>
                    <span v-if="temperature !== null && temperature !== undefined" class="app-chip app-chip-brand">Temp {{ temperature }}</span>
                    <span v-if="toolCount" class="app-chip"> 🛠️ {{ toolCount }} </span>
                    <span v-if="skillCount" class="app-chip"> 🧩 {{ skillCount }} </span>
                    <span v-if="knowledgeCount" class="app-chip"> 📚 {{ knowledgeCount }} </span>
                    <span v-if="mcpCount" class="app-chip"> 🔌 {{ mcpCount }} </span>
                </div>
                <p class="text-faint truncate text-[11px]">{{ description || t('chat.welcomeDesc') }}</p>
            </div>
        </div>

        <div class="flex shrink-0 items-center gap-2">
            <button
                v-if="hasMessages"
                type="button"
                class="app-btn app-btn-outline !px-2.5 !py-1.5"
                :title="t('chat.exportMarkdown')"
                @click="emit('export')"
            >
                <span>📥</span>
                <span class="hidden sm:inline">{{ t('chat.exportMarkdown') }}</span>
            </button>
            <button type="button" class="app-btn app-btn-ghost !px-2.5 !py-1.5" :title="t('chat.newChat')" @click="emit('new-chat')">＋</button>
        </div>
    </div>
</template>
