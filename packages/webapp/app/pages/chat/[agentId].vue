<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import { extractApiError, formatBytes, isQuotaError, type AgentDetail, type AttachmentRecord, type ConversationSummary } from '@commons/contract';
import { DefaultChatTransport, type FileUIPart, type UIMessage } from 'ai';
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

/** 待发送的附件（发送成功后清空；失败时保留，避免用户重选） */
const pendingAttachments = ref<AttachmentRecord[]>([]);
const attachPickerOpen = ref(false);
const attachOptions = ref<AttachmentRecord[]>([]);
const attachLoading = ref(false);
const attachError = ref('');
const chatFileInput = ref<HTMLInputElement | null>(null);
const uploadingInChat = ref(false);

/**
 * 把待发送附件解析成 AI SDK 的 FileUIPart。
 *
 * 必须走服务端的 chat-parts 接口而不能直接用附件列表里的 url：
 * 列表返回的是**预签名地址**（默认 1 小时过期），写进消息历史后就成了死链。
 * chat-parts 对私有桶返回稳定的站内路径，公开桶返回公共地址。
 */
async function resolveChatParts(items: AttachmentRecord[]): Promise<FileUIPart[]> {
    if (!items.length) return [];
    try {
        const res = await $fetch<{ parts: FileUIPart[] }>('/api/attachments/chat-parts', {
            method: 'POST',
            body: { ids: items.map((a) => a.id) },
        });
        if (res.parts?.length) return res.parts;
    } catch {
        // 接口异常时回退站内路径：虽不如服务端权威，但不会写入会过期的签名地址
    }
    return items.map((item) => ({
        type: 'file' as const,
        mediaType: item.mimeType || 'application/octet-stream',
        filename: item.filename,
        url: `/api/attachments/${item.id}/raw`,
    }));
}

/** 打开附件选择器：拉取最近上传的附件供选择 */
async function openAttachPicker() {
    attachPickerOpen.value = true;
    attachLoading.value = true;
    attachError.value = '';
    try {
        const res = await $fetch<{ attachments: AttachmentRecord[] }>('/api/attachments', { query: { pageSize: 25 } });
        attachOptions.value = res.attachments;
    } catch (e) {
        attachError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        attachLoading.value = false;
    }
}

function pickAttachment(item: AttachmentRecord) {
    if (pendingAttachments.value.some((a) => a.id === item.id)) return;
    if (pendingAttachments.value.length >= 5) {
        attachError.value = t('chat.attachLimit');
        return;
    }
    pendingAttachments.value.push(item);
    attachPickerOpen.value = false;
}

function removePending(id: string) {
    pendingAttachments.value = pendingAttachments.value.filter((a) => a.id !== id);
}

/** 在聊天里直接选本地文件上传（无需先去附件页） */
async function onChatFileChange(event: Event) {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    uploadingInChat.value = true;
    attachError.value = '';
    try {
        const form = new FormData();
        form.append('file', file);
        form.append('category', 'chat');
        const created = await $fetch<AttachmentRecord>('/api/attachments', { method: 'POST', body: form });
        if (pendingAttachments.value.length >= 5) {
            attachError.value = t('chat.attachLimit');
        } else {
            pendingAttachments.value.push(created);
        }
    } catch (e) {
        attachError.value = extractApiError(e, t('common.error'));
    } finally {
        uploadingInChat.value = false;
    }
}

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

/** 会话历史加载失败（区别于「空会话」），以及快速切换会话时的过期响应护栏 */
const loadError = ref('');
let loadToken = 0;

async function loadConversation(id: string) {
    const token = ++loadToken;
    loadError.value = '';
    try {
        const res = await $fetch<{ messages: UIMessage[] }>(`/api/conversations/${id}`);
        // 迟到的响应可能覆盖用户随后点击的会话，只有最新一次切换可以写入状态
        if (token !== loadToken) return;
        chat.value = buildChat(id, res.messages as UIMessage[]);
        currentConversationId.value = id;
        nextTick(scrollToBottom);
    } catch (e) {
        if (token !== loadToken) return;
        loadError.value = extractApiError(e, t('common.error'));
    }
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

/** 建会话与附件解析都要 await，期间按钮仍是「发送」；连点会建出两个会话并各扣一次额度 */
const submitting = ref(false);

async function handleSubmit(overrideText?: string) {
    const text = (overrideText ?? input.value).trim();
    // 允许只发附件（无文字）
    if (!text && !pendingAttachments.value.length) return;
    if (submitting.value) return;
    submitting.value = true;

    try {
        // 首次发送时自动创建会话。创建失败必须保留输入内容：
        // 否则用户输入被清空又没发出去，只能重新敲一遍。
        let current = chat.value;
        if (!current) {
            try {
                const id = await createConversation();
                current = buildChat(id);
                chat.value = current;
                currentConversationId.value = id;
            } catch (e) {
                submitError.value = extractApiError(e, t('common.error'));
                return;
            }
        }

        const files = await resolveChatParts(pendingAttachments.value);
        input.value = '';
        pendingAttachments.value = [];
        submitError.value = '';
        // AI SDK 的 sendMessage 支持 { text, files }：files 会作为 file part 进入消息
        current.sendMessage(files.length ? { text, files } : { text });
        nextTick(scrollToBottom);
    } finally {
        submitting.value = false;
    }
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

/** 发送前的本地错误（如建会话失败）。独立于 chat.error，避免被 AI SDK 的流状态覆盖。 */
const submitError = ref('');

async function refreshConversations() {
    try {
        conversations.value = await $fetch('/api/conversations', { query: { agentId } });
    } catch (e) {
        conversations.value = [];
        loadError.value = extractApiError(e, t('common.error'));
    }
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

            <!-- 对话页宣传栏（管理端可投放 chat / global 位置） -->
            <div class="px-4 pt-3">
                <BulletinBanner position="chat" />
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

            <!-- 发送前本地错误（建会话失败）与会话历史加载失败：不渲染就会被误当成空会话 -->
            <div
                v-if="submitError || loadError"
                class="rounded-2xl border p-3 text-xs"
                style="
                    border-color: color-mix(in oklab, var(--danger) 35%, transparent);
                    background-color: color-mix(in oklab, var(--danger) 10%, transparent);
                    color: var(--danger);
                "
            >
                <div class="flex items-center justify-between gap-3">
                    <span>{{ submitError || loadError }}</span>
                    <button
                        v-if="loadError && !submitError"
                        type="button"
                        class="font-bold underline"
                        @click="loadConversation(currentConversationId || conversations[0]?.id || '')"
                    >
                        {{ t('common.retry') }}
                    </button>
                </div>
            </div>

            <!-- 输入栏 -->
            <form class="p-3.5" style="border-top: 1px solid var(--line); background-color: var(--surface)" @submit.prevent="() => handleSubmit()">
                <!-- 待发送附件 -->
                <div v-if="pendingAttachments.length" class="mb-2 flex flex-wrap gap-2">
                    <span v-for="a in pendingAttachments" :key="a.id" class="app-chip max-w-[14rem] !py-1">
                        <AppIcon :name="a.isImage ? 'file-image-outline' : 'file-outline'" :size="13" />
                        <span class="truncate">{{ a.filename }}</span>
                        <span class="text-faint text-[10px]">{{ formatBytes(a.size) }}</span>
                        <button type="button" class="text-faint hover:text-default" :title="t('common.delete')" @click="removePending(a.id)">✕</button>
                    </span>
                </div>
                <div v-if="attachError" class="app-alert app-alert-danger mb-2 text-[11px]">{{ attachError }}</div>

                <div class="relative flex items-center gap-2.5">
                    <!-- 附件入口：选择已有附件或直接上传 -->
                    <button
                        type="button"
                        class="app-btn app-btn-ghost app-btn-icon shrink-0"
                        :title="t('chat.attach')"
                        :disabled="uploadingInChat"
                        @click="openAttachPicker"
                    >
                        <AppIcon name="paperclip" :size="18" />
                    </button>
                    <input ref="chatFileInput" type="file" class="hidden" @change="onChatFileChange" />

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
                    <button v-else type="submit" class="app-btn app-btn-primary !px-6" :disabled="submitting">
                        {{ t('chat.send') }}
                    </button>
                </div>
                <div class="text-faint mt-1.5 flex items-center justify-between px-1 text-[11px] select-none">
                    <span>💡 {{ t('chat.shortcutHint') }}</span>
                    <span v-if="input.length > 0">{{ input.length }} 字符</span>
                </div>
            </form>
        </section>

        <!-- 附件选择弹层：列最近上传的附件，也可直接上传新文件 -->
        <Teleport to="body">
            <div v-if="attachPickerOpen" class="app-modal-backdrop" @click.self="attachPickerOpen = false">
                <div class="app-card w-full max-w-lg p-5">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-black">{{ t('chat.attach') }}</h3>
                        <button type="button" class="text-faint hover:text-default" @click="attachPickerOpen = false">✕</button>
                    </div>

                    <div class="mt-3 flex gap-2">
                        <button type="button" class="app-btn app-btn-outline !py-1.5 text-xs" :disabled="uploadingInChat" @click="chatFileInput?.click()">
                            <AppIcon name="tray-arrow-up" :size="14" />
                            <span>{{ uploadingInChat ? t('attachments.uploading') : t('chat.uploadAndAttach') }}</span>
                        </button>
                        <NuxtLink to="/attachments" class="app-btn app-btn-ghost !py-1.5 text-xs">{{ t('attachments.title') }} →</NuxtLink>
                    </div>

                    <div v-if="attachLoading" class="mt-3 space-y-2">
                        <div v-for="i in 3" :key="i" class="app-skeleton h-10" />
                    </div>
                    <div v-else-if="attachOptions.length" class="mt-3 max-h-72 space-y-2 overflow-y-auto">
                        <button
                            v-for="item in attachOptions"
                            :key="item.id"
                            type="button"
                            class="app-card app-card-hover flex w-full items-center gap-3 p-2.5 text-left"
                            @click="pickAttachment(item)"
                        >
                            <span class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[color:var(--surface-3)]">
                                <img v-if="item.isImage && item.url" :src="item.url" :alt="item.filename" class="h-full w-full object-cover" />
                                <AppIcon v-else :name="'file-outline'" :size="16" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-xs font-bold">{{ item.filename }}</span>
                                <span class="text-faint text-[10px]">{{ formatBytes(item.size) }}</span>
                            </span>
                            <span v-if="pendingAttachments.some((a) => a.id === item.id)" class="app-badge app-badge-success shrink-0 !text-[10px]">
                                {{ t('common.confirm') }}
                            </span>
                        </button>
                    </div>
                    <p v-else class="text-faint mt-3 py-8 text-center text-xs">{{ t('attachments.empty') }}</p>
                </div>
            </div>
        </Teleport>
    </div>
</template>
