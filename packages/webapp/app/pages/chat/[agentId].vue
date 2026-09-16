<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import { extractApiError, isQuotaError, type AgentDetail, type ConversationSummary } from '@contract';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useI18n } from 'vue-i18n';
import { downloadMarkdownFile, formatConversationMarkdown } from '~/utils/markdown-export';

definePageMeta({ middleware: 'auth' });

const { t } = useI18n();
const route = useRoute();
const agentId = route.params.agentId as string;

type ConversationItem = ConversationSummary;

const { data: agent } = await useFetch<AgentDetail>(`/api/agents/${agentId}`);

const conversations = ref<ConversationItem[]>([]);
const currentConversationId = ref<string | null>((route.query.c as string) || null);
const input = ref('');
const chat = shallowRef<Chat<UIMessage> | null>(null);
const scrollRef = ref<HTMLElement | null>(null);

const searchQuery = ref('');
const showScrollBottom = ref(false);
const hasNewMessage = ref(false);

const filteredConversations = computed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return conversations.value;
    return conversations.value.filter((c) => c.title.toLowerCase().includes(q));
});

function onScroll() {
    if (!scrollRef.value) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.value;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    showScrollBottom.value = distanceToBottom > 160;
    if (!showScrollBottom.value) {
        hasNewMessage.value = false;
    }
}

function scrollToBottom() {
    scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight, behavior: 'smooth' });
    showScrollBottom.value = false;
    hasNewMessage.value = false;
}

function fillPrompt(prompt: string) {
    input.value = prompt;
}

// 会话内联重命名状态
const editingTitleId = ref<string | null>(null);
const editTitleInput = ref('');

function buildChat(conversationId: string, history: UIMessage[] = []) {
    return new Chat<UIMessage>({
        id: conversationId,
        messages: history,
        transport: new DefaultChatTransport({
            api: '/api/chat',
            body: { agentId, conversationId },
        }),
    });
}

async function loadConversation(id: string) {
    const res = await $fetch<{ messages: UIMessage[] }>(`/api/conversations/${id}`);
    chat.value = buildChat(id, res.messages as UIMessage[]);
    currentConversationId.value = id;
    nextTick(scrollToBottom);
}

async function createConversation(): Promise<string> {
    const conv = await $fetch<{ id: string }>('/api/conversations', {
        method: 'POST',
        body: { agentId },
    });
    await refreshConversations();
    return conv.id;
}

onMounted(async () => {
    await refreshConversations();
    if (currentConversationId.value) {
        await loadConversation(currentConversationId.value);
    } else if (conversations.value.length > 0) {
        await loadConversation(conversations.value[0]!.id);
    }
});

async function handleSubmit(overrideText?: string) {
    const text = (overrideText ?? input.value).trim();
    if (!text) return;

    // 首次发送时自动创建会话
    let current = chat.value;
    if (!current) {
        const id = await createConversation();
        current = buildChat(id);
        chat.value = current;
        currentConversationId.value = id;
    }
    input.value = '';
    current.sendMessage({ text });
    nextTick(scrollToBottom);
}

watch(
    () => chat.value?.messages.length,
    () => {
        if (showScrollBottom.value) {
            hasNewMessage.value = true;
        } else {
            nextTick(scrollToBottom);
        }
    },
);

const isQuotaExceeded = computed(() => isQuotaError(chat.value?.error));

/** 统一的错误文案（h3 / AI SDK 的错误对象结构差异较大，交给契约层归一化） */
const errorText = computed(() => extractApiError(chat.value?.error, t('common.error')));

async function refreshConversations() {
    conversations.value = await $fetch('/api/conversations', { query: { agentId } });
}

async function deleteConversation(id: string) {
    if (!confirm(t('chat.deleteConfirm'))) return;
    try {
        await $fetch(`/api/conversations/${id}`, { method: 'DELETE' });
        await refreshConversations();
        if (currentConversationId.value === id) {
            if (conversations.value.length > 0) {
                await loadConversation(conversations.value[0]!.id);
            } else {
                chat.value = null;
                currentConversationId.value = null;
            }
        }
    } catch (e: any) {
        alert(extractApiError(e, t('common.error')));
    }
}

function startRename(c: ConversationItem) {
    editingTitleId.value = c.id;
    editTitleInput.value = c.title;
}

async function saveRename(id: string) {
    const newTitle = editTitleInput.value.trim();
    if (!newTitle) {
        editingTitleId.value = null;
        return;
    }
    try {
        await $fetch(`/api/conversations/${id}`, {
            method: 'PATCH',
            body: { title: newTitle },
        });
        await refreshConversations();
    } catch (e: any) {
        alert(extractApiError(e, t('common.error')));
    } finally {
        editingTitleId.value = null;
    }
}

function selectConversation(id: string) {
    loadConversation(id);
}

// 导出当前对话为 Markdown 文件
function exportMarkdown() {
    if (!chat.value?.messages.length) {
        alert(t('chat.noMessages'));
        return;
    }
    const currentConv = conversations.value.find((c) => c.id === currentConversationId.value);
    const title = currentConv?.title || t('chat.newChat');
    const md = formatConversationMarkdown({
        title,
        agentName: agent.value?.name || t('chat.welcomeTitle'),
        model: agent.value?.model || 'default',
        messages: chat.value.messages as any,
    });
    downloadMarkdownFile(`${title}_${new Date().toISOString().slice(0, 10)}`, md);
}

// 引导提示词
const starterPrompts = computed(() => [
    t('chat.starterPrompts.0') || '🎯 介绍一下你的核心功能与擅长领域',
    t('chat.starterPrompts.1') || '💡 给我提供 3 个你可以帮我完成的实用任务',
    t('chat.starterPrompts.2') || '🛠️ 你可以使用哪些外部工具或知识库？',
]);
</script>

<template>
    <div class="flex h-[calc(100vh-8.5rem)] gap-4">
        <!-- 侧边栏：历史会话 -->
        <aside class="app-card hidden w-64 shrink-0 flex-col overflow-hidden md:flex">
            <div class="app-divider border-t-0 p-3">
                <NuxtLink to="/chat" class="text-muted-2 hover:text-brand flex items-center gap-1.5 text-xs font-semibold transition-colors">
                    <span>←</span>
                    <span>{{ t('chat.agentList') }}</span>
                </NuxtLink>
            </div>
            <div class="p-3">
                <button class="app-btn app-btn-primary w-full" @click="() => createConversation().then(loadConversation)">+ {{ t('chat.newChat') }}</button>
            </div>
            <div class="px-2.5 pb-2">
                <input v-model="searchQuery" :placeholder="t('chat.searchChat')" class="app-input w-full !px-2.5 !py-1 !text-xs" />
            </div>
            <ul class="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
                <li v-for="c in filteredConversations" :key="c.id" class="group relative flex items-center">
                    <template v-if="editingTitleId === c.id">
                        <input
                            v-model="editTitleInput"
                            class="app-input !px-2.5 !py-1.5 !text-xs"
                            @keyup.enter="saveRename(c.id)"
                            @blur="saveRename(c.id)"
                            @vue:mounted="(vnode: any) => vnode.el.focus()"
                        />
                    </template>
                    <template v-else>
                        <button
                            :class="[
                                'w-full truncate rounded-xl px-3 py-2 pr-14 text-left text-xs transition-colors',
                                c.id === currentConversationId ? 'bg-brand-soft font-semibold' : 'text-soft hover:bg-surface-3',
                            ]"
                            @click="selectConversation(c.id)"
                        >
                            {{ c.title }}
                        </button>
                        <div class="absolute right-2 hidden items-center gap-1 group-hover:flex">
                            <button
                                type="button"
                                class="text-faint hover:text-brand rounded p-1 transition-colors"
                                :title="t('chat.renameChat')"
                                @click.stop="startRename(c)"
                            >
                                ✎
                            </button>
                            <button
                                type="button"
                                class="text-faint rounded p-1 transition-colors hover:text-[color:var(--danger)]"
                                :title="t('chat.deleteChat')"
                                @click.stop="deleteConversation(c.id)"
                            >
                                🗑
                            </button>
                        </div>
                    </template>
                </li>
                <li v-if="!filteredConversations.length" class="text-faint px-3 py-4 text-center text-xs">
                    {{ searchQuery ? t('admin.noData') : t('chat.noMessages') }}
                </li>
            </ul>
        </aside>

        <!-- 聊天主视窗 -->
        <section class="app-card relative flex min-w-0 flex-1 flex-col overflow-hidden !rounded-2xl">
            <!-- 智能体顶部信息条 -->
            <div class="flex items-center justify-between px-4 py-3" style="border-bottom: 1px solid var(--line); background-color: var(--surface-2)">
                <div class="flex min-w-0 items-center gap-3">
                    <div class="app-avatar-icon h-10 w-10 shrink-0 text-xl">
                        {{ agent?.emoji || agent?.avatar || '🤖' }}
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <h2 class="truncate text-sm font-bold">{{ agent?.name || t('chat.welcomeTitle') }}</h2>
                            <span class="app-chip font-mono text-[10px]">{{ agent?.model || 'deepseek-chat' }}</span>
                            <span v-if="agent?.temperature !== null && agent?.temperature !== undefined" class="app-chip app-chip-brand text-[9px]">
                                Temp {{ agent.temperature }}
                            </span>
                            <span v-if="agent?.tools?.length" class="app-chip text-[9px]"> 🛠️ {{ agent.tools.length }} </span>
                            <span v-if="agent?.skills?.length" class="app-chip text-[9px]"> 🧩 {{ agent.skills.length }} </span>
                            <span v-if="agent?.knowledgeBases?.length" class="app-chip text-[9px]" :title="agent.knowledgeBases.map((k) => k.name).join('、')">
                                📚 {{ agent.knowledgeBases.length }}
                            </span>
                            <span v-if="agent?.mcpServers?.length" class="app-chip text-[9px]" :title="agent.mcpServers.map((m) => m.name).join('、')">
                                🔌 {{ agent.mcpServers.length }}
                            </span>
                        </div>
                        <p class="text-faint truncate text-[11px]">{{ agent?.description || t('chat.welcomeDesc') }}</p>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <button
                        v-if="chat?.messages?.length"
                        type="button"
                        class="app-btn app-btn-outline !px-2.5 !py-1.5"
                        :title="t('chat.exportMarkdown')"
                        @click="exportMarkdown"
                    >
                        <span>📥</span>
                        <span class="hidden sm:inline">{{ t('chat.exportMarkdown') }}</span>
                    </button>
                    <button
                        type="button"
                        class="app-btn app-btn-ghost !px-2.5 !py-1.5"
                        :title="t('chat.newChat')"
                        @click="() => createConversation().then(loadConversation)"
                    >
                        ＋
                    </button>
                </div>
            </div>

            <!-- 消息列表与冷启动卡片 -->
            <div ref="scrollRef" class="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" style="background-color: var(--surface-2)" @scroll="onScroll">
                <template v-if="chat && chat.messages.length > 0">
                    <ChatMessage v-for="m in chat.messages" :key="m.id" :message="m" />
                    <div v-if="chat.status === 'submitted'" class="text-faint flex items-center gap-2 py-2 text-xs">
                        <span class="inline-block animate-spin">🌀</span>
                        <span>{{ t('chat.thinking') }}</span>
                    </div>

                    <!-- 错误或配额耗尽处理 -->
                    <div
                        v-if="chat.error"
                        class="rounded-2xl border p-4 text-xs"
                        :class="isQuotaExceeded ? 'border-brand-soft bg-brand-soft' : ''"
                        :style="
                            isQuotaExceeded
                                ? undefined
                                : {
                                      borderColor: 'color-mix(in oklab, var(--danger) 35%, transparent)',
                                      backgroundColor: 'color-mix(in oklab, var(--danger) 10%, transparent)',
                                      color: 'var(--danger)',
                                  }
                        "
                    >
                        <template v-if="isQuotaExceeded">
                            <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                                <div class="flex items-center gap-2.5">
                                    <span class="text-2xl">👑</span>
                                    <div>
                                        <p class="text-sm font-bold">{{ t('chat.quotaExceeded') }}</p>
                                        <p class="mt-0.5 text-[11px] opacity-80">{{ t('billing.subtitle') }}</p>
                                    </div>
                                </div>
                                <NuxtLink to="/pricing" class="app-btn app-btn-primary">
                                    {{ t('chat.upgradeNow') }}
                                </NuxtLink>
                            </div>
                        </template>
                        <template v-else>
                            <div class="flex items-center justify-between">
                                <span>{{ errorText }}</span>
                                <button class="font-bold underline" @click="() => chat?.regenerate()">{{ t('common.retry') }}</button>
                            </div>
                        </template>
                    </div>
                </template>

                <!-- 冷启动空状态：欢迎卡片与引导提示词 -->
                <div v-else class="flex h-full flex-col items-center justify-center py-10 text-center">
                    <div class="app-avatar-icon h-16 w-16 !rounded-3xl text-3xl">
                        {{ agent?.emoji || agent?.avatar || '🤖' }}
                    </div>
                    <h3 class="mt-3 text-base font-bold">{{ t('chat.welcomeTitle') }} · {{ agent?.name || '' }}</h3>
                    <p class="text-faint mt-1 max-w-sm text-xs">
                        {{ agent?.description || t('chat.welcomeDesc') }}
                    </p>

                    <div class="mt-6 flex w-full max-w-md flex-col gap-2.5">
                        <div
                            v-for="prompt in starterPrompts"
                            :key="prompt"
                            class="app-card app-card-hover group flex items-center justify-between px-4 py-3 text-left text-xs transition-all"
                        >
                            <button type="button" class="text-soft flex-1 text-left" @click="handleSubmit(prompt)">
                                {{ prompt }}
                            </button>
                            <button
                                type="button"
                                class="text-faint hover:text-brand ml-2 hidden shrink-0 rounded p-1 text-xs group-hover:block"
                                :title="t('chat.usePrompt')"
                                @click="fillPrompt(prompt)"
                            >
                                ✏️
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 回到底部悬浮微按钮 -->
            <div v-if="showScrollBottom" class="absolute right-6 bottom-24 z-20 transition-all duration-200">
                <button
                    type="button"
                    class="bg-primary-600 hover:bg-primary-700 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-md transition-transform active:scale-95"
                    @click="scrollToBottom"
                >
                    <span>↓ {{ t('chat.scrollToBottom') }}</span>
                    <span v-if="hasNewMessage" class="flex h-2 w-2 animate-ping rounded-full bg-amber-300" />
                </button>
            </div>

            <!-- 输入栏 -->
            <form class="p-3.5" style="border-top: 1px solid var(--line); background-color: var(--surface)" @submit.prevent="() => handleSubmit()">
                <div class="relative flex items-center gap-2.5">
                    <div class="relative flex-1">
                        <input v-model="input" :placeholder="t('chat.inputPlaceholder')" class="app-input w-full !pr-8" />
                        <button
                            v-if="input"
                            type="button"
                            class="text-faint hover:text-default absolute top-1/2 right-2.5 -translate-y-1/2 text-xs"
                            :title="t('chat.clearInput')"
                            @click="input = ''"
                        >
                            ✕
                        </button>
                    </div>
                    <button
                        v-if="chat?.status === 'streaming' || chat?.status === 'submitted'"
                        type="button"
                        class="app-btn app-btn-outline"
                        @click="chat?.stop()"
                    >
                        {{ t('chat.stop') }}
                    </button>
                    <button v-else type="submit" class="app-btn app-btn-primary !px-6">
                        {{ t('chat.send') }}
                    </button>
                </div>
                <div class="text-faint mt-1.5 flex items-center justify-between px-1 text-[11px] select-none">
                    <span>💡 {{ t('chat.shortcutHint') }}</span>
                    <span v-if="input.length > 0">{{ input.length }} 字符</span>
                </div>
            </form>
        </section>
    </div>
</template>
