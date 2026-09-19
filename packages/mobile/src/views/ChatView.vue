<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import { Markdown } from '@comark/vue';
import jsonRender from '@comark/vue/plugins/json-render';
import {
    extractApiError,
    formatBytes,
    isQuotaError,
    type AgentDetail,
    type AttachmentRecord,
    type ChatMessage,
    type ConversationSummary,
} from '@commons/contract';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonModal, IonTitle, IonToolbar } from '@ionic/vue';
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { api, apiUrl, extractApiError as extractError, getToken } from '../api/auth';
import { uiComponents } from '../components/json-ui';
import { useDialog } from '../composables/useDialog';
import { useTheme } from '../composables/useTheme';
import { isNativeShell, pickFiles, uploadAttachment } from '../composables/useUpload';
import PageShell from './PageShell.vue';

const { t } = useI18n();
const { toggleMode } = useTheme();
const { confirmDialog, toast } = useDialog();
const route = useRoute();
const router = useRouter();
const agentId = route.params.agentId as string;

const agentInfo = ref<AgentDetail | null>(null);
const chat = shallowRef<Chat<UIMessage> | null>(null);
const input = ref('');
const conversationId = ref<string | null>(null);
const conversations = ref<ConversationSummary[]>([]);
const convModalOpen = ref(false);
const sending = ref(false);
const loadError = ref('');

/** 待发送附件（发送成功后清空；失败保留，避免用户重选） */
const pendingAttachments = ref<AttachmentRecord[]>([]);
const attachPickerOpen = ref(false);
const attachOptions = ref<AttachmentRecord[]>([]);
const attachLoading = ref(false);
const attachError = ref('');
const attachUploading = ref(false);
const nativeShell = isNativeShell();
/** 附件图片大图预览 */
const previewImage = ref('');

const starterPrompts = computed(() => [
    t('chat.starterPrompts.0') || '🎯 介绍一下你的功能与擅长领域',
    t('chat.starterPrompts.1') || '💡 给我提供 3 个实用的任务建议',
    t('chat.starterPrompts.2') || '🛠️ 你可以使用哪些工具或技能？',
]);

type ChatSegment =
    { kind: 'text'; value: string } | { kind: 'reasoning'; value: string } | { kind: 'file'; value: string; url: string; mediaType: string; isImage: boolean };

const segmentsOf = (message: UIMessage): ChatSegment[] => {
    const out: ChatSegment[] = [];
    for (const part of message.parts ?? []) {
        if (part.type === 'text' && part.text?.trim()) {
            out.push({ kind: 'text', value: part.text });
        } else if (part.type === 'reasoning') {
            const rText = (part as any).reasoning ?? (part as any).text ?? '';
            if (rText?.trim()) {
                out.push({ kind: 'reasoning', value: rText });
            }
        } else if (part.type === 'file') {
            // AI SDK 7 里图片也走 file part（靠 mediaType 区分），没有独立的 image 类型。
            // 此前不处理 file，只发附件的消息会渲染成空白。
            const filePart = part as { url?: unknown; filename?: unknown; mediaType?: unknown };
            const url = typeof filePart.url === 'string' ? filePart.url : '';
            if (!url) continue;
            const mediaType = typeof filePart.mediaType === 'string' ? filePart.mediaType : 'application/octet-stream';
            out.push({
                kind: 'file',
                value: typeof filePart.filename === 'string' && filePart.filename ? filePart.filename : t('chat.attachedFile'),
                url,
                mediaType,
                isImage: mediaType.startsWith('image/'),
            });
        }
    }
    return out;
};

/** 提取本轮调用的工具名（去重），用于气泡顶部的工具标记 */
const toolNamesOf = (message: UIMessage) =>
    [
        ...new Set((message.parts ?? []).filter((p: any) => typeof p.type === 'string' && p.type.startsWith('tool-')).map((p: any) => String(p.type).slice(5))),
    ] as string[];

// json-render 插件：把 Markdown 中的 ```json-render 代码块渲染成生成式 UI 组件
const plugins = [jsonRender()];

const segments = computed(() =>
    chat.value ? chat.value.messages.map((m: UIMessage) => ({ m, segs: segmentsOf(m), tools: toolNamesOf(m), isUser: m.role === 'user' })) : [],
);

const isQuotaExceeded = computed(() => isQuotaError(chat.value?.error));
const errorText = computed(() => extractApiError(chat.value?.error, t('common.error')));

function buildChat(convId: string, history: UIMessage[] = []) {
    return new Chat<UIMessage>({
        id: convId,
        messages: history,
        transport: new DefaultChatTransport({
            api: apiUrl('/api/chat'),
            headers: (): Record<string, string> => {
                const token = getToken();
                return token ? { Authorization: `Bearer ${token}` } : {};
            },
            prepareSendMessagesRequest: ({ messages }) => ({
                body: { agentId, conversationId: convId, messages },
            }),
        }),
    });
}

async function loadAgentInfo() {
    try {
        agentInfo.value = await api<AgentDetail>(`/api/agents/${agentId}`);
    } catch (e) {
        loadError.value = extractError(e, t('common.error'));
    }
}

async function loadConversations() {
    try {
        conversations.value = await api<ConversationSummary[]>(`/api/conversations?agentId=${encodeURIComponent(agentId)}`);
    } catch {
        conversations.value = [];
    }
}

/** 快速切换会话时的过期响应护栏：迟到的响应不得覆盖用户当前选中的会话 */
let chatToken = 0;

async function switchConversation(conv: ConversationSummary) {
    const token = ++chatToken;
    conversationId.value = conv.id;
    try {
        const res = await api<{ messages: ChatMessage[] }>(`/api/conversations/${conv.id}`);
        if (token !== chatToken) return;
        chat.value = buildChat(conv.id, (res.messages ?? []) as unknown as UIMessage[]);
    } catch (e) {
        if (token !== chatToken) return;
        chat.value = buildChat(conv.id);
        // 历史拉不到也要说明：否则界面只剩一个空会话，会被读成「这个会话没有消息」
        loadError.value = extractError(e, t('chat.historyLoadFailed'));
    }
    convModalOpen.value = false;
}

async function startNewConversation() {
    const token = ++chatToken;
    try {
        const res = await api<{ id: string }>('/api/conversations', {
            method: 'POST',
            body: JSON.stringify({ agentId }),
        });
        if (token !== chatToken) return;
        conversationId.value = res.id;
        chat.value = buildChat(res.id);
        await loadConversations();
    } catch (e) {
        if (token !== chatToken) return;
        loadError.value = extractError(e, t('common.error'));
    }
    convModalOpen.value = false;
}

async function deleteConv(id: string, event: Event) {
    event.stopPropagation();
    if (!(await confirmDialog(t('chat.deleteConfirm')))) return;
    try {
        await api(`/api/conversations/${id}`, { method: 'DELETE' });
        await loadConversations();
        if (conversationId.value === id) {
            if (conversations.value.length > 0) {
                await switchConversation(conversations.value[0]!);
            } else {
                await startNewConversation();
            }
        }
    } catch (e) {
        toast(extractError(e, t('common.error')));
    }
}

const contentRef = ref<any>(null);
const showScrollBottom = ref(false);
const hasNewMessage = ref(false);
const copiedId = ref<string | null>(null);

function onScroll(event: any) {
    const detail = event.detail;
    if (detail && typeof detail.scrollTop === 'number') {
        showScrollBottom.value = detail.scrollTop > 260;
        if (!showScrollBottom.value) {
            hasNewMessage.value = false;
        }
    }
}

function scrollToBottom() {
    const el = contentRef.value?.$el || contentRef.value;
    if (el?.scrollToBottom) {
        el.scrollToBottom(300);
    }
    showScrollBottom.value = false;
    hasNewMessage.value = false;
}

function fillPrompt(prompt: string) {
    input.value = prompt;
}

async function copyMessage(m: UIMessage) {
    const texts: string[] = [];
    for (const p of m.parts ?? []) {
        if (p.type === 'text' && p.text) texts.push(p.text);
    }
    const content = texts.join('\n');
    if (!content) return;
    try {
        await navigator.clipboard.writeText(content);
        copiedId.value = m.id;
        setTimeout(() => {
            if (copiedId.value === m.id) copiedId.value = null;
        }, 1800);
    } catch {
        // ignore
    }
}

onMounted(async () => {
    await Promise.all([loadAgentInfo(), loadConversations()]);
    if (conversations.value.length > 0) {
        await switchConversation(conversations.value[0]!);
    } else {
        await startNewConversation();
    }
});

watch(
    () => chat.value?.messages.length,
    () => {
        if (showScrollBottom.value) {
            hasNewMessage.value = true;
        } else {
            nextTick(() => scrollToBottom());
        }
    },
);

async function handleSubmit(overrideText?: string) {
    const text = (overrideText ?? input.value).trim();
    // 允许只发附件（无文字）
    if (!text && !pendingAttachments.value.length) return;
    // 建会话与附件解析都要 await：在途标记必须先置，否则期间连点会建出两个会话
    if (sending.value) return;
    sending.value = true;
    loadError.value = '';
    try {
        if (!conversationId.value || !chat.value) {
            await startNewConversation();
            // 建会话失败：保留输入与附件直接返回，否则用户白敲一遍且什么都没发出去
            if (!chat.value) return;
        }

        // 附件必须经服务端解析：私有桶的预签名地址会过期，不能写进消息历史
        let files: { type: 'file'; mediaType: string; filename: string; url: string }[] = [];
        if (pendingAttachments.value.length) {
            try {
                const res = await api<{ parts: typeof files }>('/api/attachments/chat-parts', {
                    method: 'POST',
                    body: JSON.stringify({ ids: pendingAttachments.value.map((a) => a.id) }),
                });
                files = res.parts ?? [];
            } catch (e) {
                loadError.value = extractError(e, t('common.error'));
                return;
            }
        }

        input.value = '';
        pendingAttachments.value = [];
        if (files.length) {
            await chat.value.sendMessage({ text, files });
        } else {
            await chat.value.sendMessage({ text });
        }
        await loadConversations();
        nextTick(() => scrollToBottom());
    } catch (e) {
        loadError.value = extractError(e, t('common.error'));
    } finally {
        sending.value = false;
    }
}

/** 上传并暂存一个待发送附件（移动端复用 useUpload 的选择与进度能力） */
async function attachFromDevice(source: 'file' | 'photo') {
    if (pendingAttachments.value.length >= 5) {
        loadError.value = t('chat.attachLimit');
        return;
    }
    attachError.value = '';
    try {
        const picked = source === 'photo' ? await pickFiles({ source: 'photo', accept: 'image/*' }) : await pickFiles({ accept: '*/*' });
        const file = picked[0];
        if (!file) return;
        attachUploading.value = true;
        const created = (await uploadAttachment(file, 'chat')) as AttachmentRecord;
        pendingAttachments.value.push(created);
    } catch (e) {
        attachError.value = extractError(e, t('common.error'));
    } finally {
        attachUploading.value = false;
    }
}

function removePendingAttachment(id: string) {
    pendingAttachments.value = pendingAttachments.value.filter((a) => a.id !== id);
}

/** 打开附件选择器：列出最近上传的附件 */
async function openAttachPicker() {
    attachPickerOpen.value = true;
    attachLoading.value = true;
    attachError.value = '';
    try {
        const res = await api<{ attachments: AttachmentRecord[] }>('/api/attachments?pageSize=25');
        attachOptions.value = res.attachments;
    } catch (e) {
        attachError.value = extractError(e, t('common.error'));
    } finally {
        attachLoading.value = false;
    }
}

function pickAttachment(item: AttachmentRecord) {
    if (pendingAttachments.value.some((a) => a.id === item.id)) {
        attachPickerOpen.value = false;
        return;
    }
    if (pendingAttachments.value.length >= 5) {
        attachError.value = t('chat.attachLimit');
        return;
    }
    pendingAttachments.value.push(item);
    attachPickerOpen.value = false;
}

/** 复制当前会话为 Markdown 文本 */
async function copyConversationMarkdown() {
    if (!chat.value?.messages?.length) {
        toast(t('chat.noMessages'));
        return;
    }
    const currentConv = conversations.value.find((c) => c.id === conversationId.value);
    const title = currentConv?.title || t('chat.newChat');
    const agentName = agentInfo.value?.name || t('chat.welcomeTitle');
    const lines: string[] = [`# 对话记录: ${title}`, '', `- 智能体: ${agentName}`, `- 驱动模型: ${agentInfo.value?.model || 'default'}`, '', '---', ''];

    for (const m of chat.value.messages) {
        lines.push(`### ${m.role === 'user' ? '👤 用户' : `🤖 ${agentName}`}`);
        lines.push('');
        for (const p of m.parts ?? []) {
            if (p.type === 'reasoning') {
                const r = ((p as any).reasoning ?? (p as any).text ?? '').trim();
                if (r) {
                    lines.push(`> 💭 **${t('chat.reasoning')}**：`);
                    for (const rl of r.split('\n')) lines.push(`> ${rl}`);
                    lines.push('');
                }
            } else if (p.type === 'text' && p.text?.trim()) {
                lines.push(p.text.trim());
                lines.push('');
            }
        }
        lines.push('');
    }

    try {
        await navigator.clipboard.writeText(lines.join('\n'));
        toast(t('common.copied'));
    } catch {
        toast(t('common.error'));
    }
}
</script>

<template>
    <PageShell>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <template v-slot:start>
                    <ion-buttons>
                        <ion-back-button default-href="/tabs/home" text="" />
                    </ion-buttons>
                </template>
                <ion-title class="!text-sm font-black">
                    <span class="mr-1">{{ agentInfo?.emoji || agentInfo?.avatar || '🤖' }}</span>
                    {{ agentInfo?.name || t('nav.chat') }}
                </ion-title>
                <div v-if="agentInfo" class="flex flex-wrap items-center gap-1 px-3 pb-1">
                    <span class="app-chip !text-[9px]">🧩 {{ agentInfo.skills?.length ?? 0 }}</span>
                    <span class="app-chip !text-[9px]">🛠️ {{ agentInfo.tools?.length ?? 0 }}</span>
                    <span v-if="agentInfo.knowledgeBases?.length" class="app-chip !text-[9px]">📚 {{ agentInfo.knowledgeBases.length }}</span>
                    <span v-if="agentInfo.mcpServers?.length" class="app-chip !text-[9px]">🔌 {{ agentInfo.mcpServers.length }}</span>
                </div>
                <template v-slot:end>
                    <ion-buttons>
                        <button type="button" class="app-btn app-btn-ghost !px-2" title="切换深浅色" @click="toggleMode">🌓</button>
                        <button type="button" class="app-btn app-btn-ghost !px-2" title="导出" @click="copyConversationMarkdown">📋</button>
                        <button type="button" class="app-btn app-btn-soft mr-1 !px-2.5" @click="convModalOpen = true">
                            <span>{{ conversations.length }}</span>
                        </button>
                    </ion-buttons>
                </template>
            </ion-toolbar>
        </ion-header>

        <ion-content ref="contentRef" :scroll-events="true" @ionScroll="onScroll">
            <div class="flex h-full flex-col">
                <!-- 消息区 -->
                <div class="flex-1 space-y-3.5 p-3.5">
                    <div v-if="loadError" class="app-alert app-alert-danger">{{ loadError }}</div>

                    <template v-if="chat && chat.messages.length > 0">
                        <div v-for="{ m, segs, tools, isUser } in segments" :key="m.id" :class="['flex', isUser ? 'justify-end' : 'justify-start']">
                            <div :class="['group relative max-w-[88%] px-3.5 py-2.5 text-sm', isUser ? 'app-bubble-user' : 'app-bubble-assistant']">
                                <div v-if="!isUser && tools.length" class="mb-2 flex flex-wrap gap-1.5">
                                    <span v-for="name in tools" :key="name" class="app-chip !text-[10px]">🔧 {{ name }}</span>
                                </div>

                                <template v-for="(seg, i) in segs" :key="i">
                                    <div
                                        v-if="seg.kind === 'reasoning'"
                                        class="my-1 mb-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap"
                                        style="
                                            border-color: color-mix(in oklab, var(--info) 28%, transparent);
                                            background-color: color-mix(in oklab, var(--info) 8%, transparent);
                                            color: var(--info);
                                        "
                                    >
                                        💭 {{ seg.value }}
                                    </div>
                                    <!-- 附件：图片可点开大图，其他文件给下载入口 -->
                                    <div v-else-if="seg.kind === 'file'" class="my-1 flex flex-wrap gap-2">
                                        <button
                                            v-if="seg.isImage"
                                            type="button"
                                            class="overflow-hidden rounded-xl border"
                                            style="border-color: var(--line)"
                                            @click="previewImage = seg.url"
                                        >
                                            <img :src="seg.url" :alt="seg.value" class="max-h-44 object-cover" />
                                        </button>
                                        <a v-else :href="seg.url" target="_blank" rel="noopener" class="app-chip max-w-[14rem] !py-1.5" :title="seg.value">
                                            <span class="truncate">{{ seg.value }}</span>
                                            <span class="text-faint text-[9px]">{{ t('chat.downloadFile') }}</span>
                                        </a>
                                    </div>
                                    <Suspense v-else>
                                        <Markdown :value="seg.value as string" :plugins="plugins" :components="uiComponents" class="markdown-body" />
                                        <template #fallback>
                                            <span class="whitespace-pre-wrap">{{ seg.value }}</span>
                                        </template>
                                    </Suspense>
                                </template>

                                <!-- 单条复制操作 -->
                                <button
                                    type="button"
                                    class="mt-1.5 inline-flex items-center gap-1 text-[10px] opacity-70 transition-opacity hover:opacity-100 active:opacity-100"
                                    @click="copyMessage(m)"
                                >
                                    <span>{{ copiedId === m.id ? '✓ ' + t('common.copied') : '📋 ' + t('common.copy') }}</span>
                                </button>
                            </div>
                        </div>

                        <div v-if="chat.status === 'submitted' || chat.status === 'streaming'" class="text-faint flex items-center gap-2 py-2 text-xs">
                            <span class="inline-block animate-spin">🌀</span>
                            <span>{{ t('chat.thinking') }}</span>
                        </div>

                        <!-- 配额 / 错误 -->
                        <div
                            v-if="chat.error"
                            :class="['rounded-2xl p-3.5 text-xs', isQuotaExceeded ? 'app-alert app-alert-warning' : 'app-alert app-alert-danger']"
                        >
                            <template v-if="isQuotaExceeded">
                                <p class="text-sm font-bold">👑 {{ t('chat.quotaExceeded') }}</p>
                                <p class="mt-1 text-[11px] opacity-90">{{ t('billing.subtitle') }}</p>
                                <button class="app-btn app-btn-primary mt-3 w-full" @click="router.push('/membership')">{{ t('chat.upgradeNow') }}</button>
                            </template>
                            <template v-else>
                                <p>{{ errorText }}</p>
                                <button class="mt-2 font-bold underline" @click="chat?.regenerate()">{{ t('common.retry') }}</button>
                            </template>
                        </div>
                    </template>

                    <!-- 冷启动引导 -->
                    <div v-else class="flex h-full flex-col items-center justify-center py-10 text-center">
                        <div class="app-avatar-icon h-16 w-16 !rounded-3xl text-3xl">{{ agentInfo?.emoji || agentInfo?.avatar || '🤖' }}</div>
                        <h3 class="mt-3 text-base font-bold">{{ t('chat.welcomeTitle') }} · {{ agentInfo?.name || '' }}</h3>
                        <p class="text-faint mt-1 max-w-xs text-xs">{{ agentInfo?.description || t('chat.welcomeDesc') }}</p>

                        <div class="mt-6 flex w-full max-w-sm flex-col gap-2.5">
                            <div
                                v-for="prompt in starterPrompts"
                                :key="prompt"
                                class="app-card app-card-hover flex items-center justify-between px-3.5 py-2.5 text-left text-xs"
                            >
                                <button type="button" class="text-soft flex-1 text-left" @click="handleSubmit(prompt)">
                                    {{ prompt }}
                                </button>
                                <button
                                    type="button"
                                    class="text-faint hover:text-brand ml-2 shrink-0 p-1 text-xs"
                                    :title="t('chat.usePrompt')"
                                    @click="fillPrompt(prompt)"
                                >
                                    ✏️
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 回到底部悬浮按钮 -->
                <div v-if="showScrollBottom" class="fixed right-4 bottom-20 z-50">
                    <button
                        type="button"
                        class="bg-primary-600 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold text-white shadow-lg transition-transform active:scale-95"
                        @click="scrollToBottom"
                    >
                        <span>↓ {{ t('chat.scrollToBottom') }}</span>
                        <span v-if="hasNewMessage" class="flex h-2 w-2 animate-ping rounded-full bg-amber-300" />
                    </button>
                </div>

                <!-- 输入栏 -->
                <div class="sticky bottom-0 p-3" style="border-top: 1px solid var(--line); background-color: var(--surface)">
                    <!-- 待发送附件 -->
                    <div v-if="pendingAttachments.length" class="mb-2 flex flex-wrap gap-2">
                        <span v-for="a in pendingAttachments" :key="a.id" class="app-chip max-w-[13rem] !py-1">
                            <span class="truncate">{{ a.filename }}</span>
                            <span class="text-faint text-[9px]">{{ formatBytes(a.size) }}</span>
                            <button type="button" class="text-faint" @click="removePendingAttachment(a.id)">✕</button>
                        </span>
                    </div>
                    <div v-if="attachError" class="app-alert app-alert-danger mb-2 text-[10px]">{{ attachError }}</div>

                    <div class="flex items-center gap-2">
                        <!-- 附件入口 -->
                        <button
                            type="button"
                            class="app-btn app-btn-ghost app-btn-icon shrink-0"
                            :title="t('chat.attach')"
                            :disabled="attachUploading"
                            @click="openAttachPicker"
                        >
                            {{ attachUploading ? '⏳' : '📎' }}
                        </button>
                        <div class="relative flex-1">
                            <input v-model="input" :placeholder="t('chat.inputPlaceholder')" class="app-input w-full !pr-7" @keyup.enter="handleSubmit()" />
                            <button
                                v-if="input"
                                type="button"
                                class="text-faint hover:text-default absolute top-1/2 right-2 -translate-y-1/2 text-xs"
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
                        <button v-else type="button" class="app-btn app-btn-primary !px-5" :disabled="sending" @click="handleSubmit()">
                            {{ t('chat.send') }}
                        </button>
                    </div>
                </div>
            </div>
        </ion-content>

        <!-- 附件选择弹层：可选最近上传的附件，也可直接拍照/选文件上传 -->
        <ion-modal :is-open="attachPickerOpen" @did-dismiss="attachPickerOpen = false">
            <ion-header class="ion-no-border">
                <ion-toolbar>
                    <ion-title class="!text-sm font-black">{{ t('chat.attach') }}</ion-title>
                    <template v-slot:end>
                        <ion-buttons>
                            <button type="button" class="app-btn app-btn-ghost !px-2" @click="attachPickerOpen = false">✕</button>
                        </ion-buttons>
                    </template>
                </ion-toolbar>
            </ion-header>
            <ion-content class="ion-padding">
                <div class="flex gap-2">
                    <button
                        v-if="nativeShell"
                        type="button"
                        class="app-btn app-btn-outline flex-1 !py-2 text-xs"
                        :disabled="attachUploading"
                        @click="attachFromDevice('photo')"
                    >
                        📷 {{ t('attachments.takePhoto') }}
                    </button>
                    <button type="button" class="app-btn app-btn-outline flex-1 !py-2 text-xs" :disabled="attachUploading" @click="attachFromDevice('file')">
                        {{ attachUploading ? t('attachments.uploading') : t('chat.uploadAndAttach') }}
                    </button>
                </div>

                <div v-if="attachLoading" class="mt-3 space-y-2">
                    <div v-for="i in 3" :key="i" class="app-skeleton h-12" />
                </div>
                <div v-else-if="attachOptions.length" class="mt-3 space-y-2">
                    <button
                        v-for="item in attachOptions"
                        :key="item.id"
                        type="button"
                        class="app-card flex w-full items-center gap-3 p-2.5 text-left"
                        @click="pickAttachment(item)"
                    >
                        <span class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[color:var(--surface-3)]">
                            <img v-if="item.isImage && item.url" :src="item.url" :alt="item.filename" class="h-full w-full object-cover" />
                            <span v-else class="text-sm">📄</span>
                        </span>
                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-[11px] font-bold">{{ item.filename }}</span>
                            <span class="text-faint text-[9px]">{{ formatBytes(item.size) }}</span>
                        </span>
                        <span v-if="pendingAttachments.some((a) => a.id === item.id)" class="app-badge app-badge-success shrink-0 !text-[9px]">✓</span>
                    </button>
                </div>
                <p v-else class="text-faint mt-6 text-center text-xs">{{ t('attachments.empty') }}</p>
            </ion-content>
        </ion-modal>

        <!-- 附件图片预览 -->
        <div v-if="previewImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" @click="previewImage = ''">
            <img :src="previewImage" alt="preview" class="max-h-full max-w-full rounded-xl object-contain" />
        </div>

        <!-- 会话切换弹层 -->
        <ion-modal :is-open="convModalOpen" @did-dismiss="convModalOpen = false">
            <ion-header class="ion-no-border">
                <ion-toolbar>
                    <ion-title class="!text-sm font-black">{{ t('nav.conversations') }}</ion-title>
                    <template v-slot:end>
                        <ion-buttons>
                            <button type="button" class="app-btn app-btn-ghost" @click="convModalOpen = false">✕</button>
                        </ion-buttons>
                    </template>
                </ion-toolbar>
            </ion-header>
            <ion-content class="ion-padding">
                <button class="app-btn app-btn-primary mb-3 w-full" @click="startNewConversation">＋ {{ t('chat.newChat') }}</button>
                <ul class="space-y-2">
                    <li v-for="c in conversations" :key="c.id" class="app-card flex items-center justify-between p-3">
                        <button type="button" class="min-w-0 flex-1 text-left" @click="switchConversation(c)">
                            <p class="truncate text-xs font-semibold">{{ c.title }}</p>
                            <p class="text-faint mt-0.5 text-[10px]">{{ new Date(c.updatedAt).toLocaleDateString() }}</p>
                        </button>
                        <button type="button" class="text-faint ml-2 p-1" @click="deleteConv(c.id, $event)">🗑</button>
                    </li>
                    <li v-if="!conversations.length" class="text-faint py-8 text-center text-xs">{{ t('chat.noMessages') }}</li>
                </ul>
            </ion-content>
        </ion-modal>
    </PageShell>
</template>
