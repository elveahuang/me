<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import { Markdown } from '@comark/vue';
import jsonRender from '@comark/vue/plugins/json-render';
import {
    extractApiError,
    formatBytes,
    formatDate,
    formatDateTime,
    isQuotaError,
    type AgentDetail,
    type AttachmentRecord,
    type AttachmentsResponse,
    type ChatMessage,
    type ConversationSummary,
} from '@commons/contract';
import { formatConversationMarkdown } from '@commons/markdown-export';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonModal, IonTitle, IonToolbar } from '@ionic/vue';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { api, apiUrl, getToken } from '../api/auth';
import BulletinBanner from '../components/BulletinBanner.vue';
import { uiComponents } from '../components/json-ui';
import { useDialog } from '../composables/useDialog';
import { useTheme } from '../composables/useTheme';
import { isNativeShell, pickFiles, uploadAttachment } from '../composables/useUpload';
import PageShell from './PageShell.vue';

const { t, locale } = useI18n();
const { toggleMode } = useTheme();
const { confirmDialog, toast } = useDialog();
const route = useRoute();
const router = useRouter();
// /chat/A → /chat/B 的 SPA 跳转复用本组件（setup 不重跑），agentId 必须是响应式的
const agentId = ref(route.params.agentId as string);

const agentInfo = ref<AgentDetail | null>(null);
const chat = shallowRef<OwnedChat | null>(null);
const input = ref('');
const conversationId = ref<string | null>(null);
const conversations = ref<ConversationSummary[]>([]);
const convModalOpen = ref(false);
const sending = ref(false);
const loadError = ref('');

/** 待发送附件：发送一经提交就和输入框一起清空（用户消息已乐观追加进会话，保留反而会让重发变成重复投递）；提交前的解析/上传失败则保留，避免用户重选 */
const pendingAttachments = ref<AttachmentRecord[]>([]);
const attachPickerOpen = ref(false);
const attachOptions = ref<AttachmentRecord[]>([]);
const attachLoading = ref(false);
const attachError = ref('');
const attachUploading = ref(false);
const nativeShell = isNativeShell();
/** 附件图片大图预览 */
const previewImage = ref('');

const starterPrompts = computed(() => [t('chat.starterPrompts.0'), t('chat.starterPrompts.1'), t('chat.starterPrompts.2')]);

type ChatSegment =
    | { kind: 'text'; value: string }
    | { kind: 'reasoning'; value: string }
    | { kind: 'file'; value: string; url: string; mediaType: string; isImage: boolean; attachmentId?: string };

/**
 * 私有桶的历史消息里存的是站内相对地址 `/api/attachments/{id}/raw`，原生壳两处都不成立：
 * 相对路径会解析到 capacitor://localhost，而 `<img>`/`<a>` 也带不上 Bearer。
 * 这里按附件 id 换取服务端预签名地址；换不到就退回绝对化的站内地址（浏览器带 cookie 仍可读）。
 */
const mediaUrls = ref(new Map<string, string>());
const mediaPending = new Set<string>();

function attachmentIdOf(url: string): string | null {
    return /^\/api\/attachments\/([^/]+)\/raw$/.exec(url)?.[1] ?? null;
}

async function resolveMedia(id: string) {
    if (mediaUrls.value.has(id) || mediaPending.has(id)) return;
    mediaPending.add(id);
    try {
        // 附件 id 来自消息 part（模型/历史内容可控），不编进单段就会让
        // `..%2F..%2Fapi%2Fadmin` 这类取值把请求改写到别的路径上
        const res = await api<{ url?: string }>(`/api/attachments/${encodeURIComponent(id)}/url`);
        if (res.url) mediaUrls.value.set(id, res.url);
    } catch {
        // 换不到预签名地址时维持站内路径，不额外打扰用户
    } finally {
        mediaPending.delete(id);
    }
}

function mediaUrl(seg: Extract<ChatSegment, { kind: 'file' }>): string {
    const id = seg.attachmentId ?? attachmentIdOf(seg.url);
    return (id ? mediaUrls.value.get(id) : undefined) ?? apiUrl(seg.url);
}

const asText = (v: unknown) => (typeof v === 'string' ? v : '');

const segmentsOf = (message: UIMessage): ChatSegment[] => {
    const out: ChatSegment[] = [];
    for (const part of message.parts ?? []) {
        if (part.type === 'text') {
            const text = asText((part as any).text);
            if (text.trim()) out.push({ kind: 'text', value: text });
        } else if (part.type === 'reasoning') {
            const rText = asText((part as any).reasoning) || asText((part as any).text);
            if (rText.trim()) {
                out.push({ kind: 'reasoning', value: rText });
            }
        } else if (part.type === 'file') {
            // AI SDK 7 里图片也走 file part（靠 mediaType 区分），没有独立的 image 类型。
            // 此前不处理 file，只发附件的消息会渲染成空白。
            const filePart = part as { url?: unknown; filename?: unknown; mediaType?: unknown; attachmentId?: unknown };
            const url = typeof filePart.url === 'string' ? filePart.url : '';
            if (!url) continue;
            const mediaType = typeof filePart.mediaType === 'string' ? filePart.mediaType : 'application/octet-stream';
            out.push({
                kind: 'file',
                value: typeof filePart.filename === 'string' && filePart.filename ? filePart.filename : t('chat.attachedFile'),
                url,
                mediaType,
                isImage: mediaType.startsWith('image/'),
                attachmentId: typeof filePart.attachmentId === 'string' ? filePart.attachmentId : undefined,
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

// 不在渲染函数里发请求：消息列表变化后统一把站内附件地址换成预签名地址
watch(
    segments,
    (list) => {
        for (const item of list) {
            for (const seg of item.segs) {
                if (seg.kind !== 'file') continue;
                const id = seg.attachmentId ?? attachmentIdOf(seg.url);
                if (id) void resolveMedia(id);
            }
        }
    },
    { immediate: true },
);

const isQuotaExceeded = computed(() => isQuotaError(chat.value?.error));
const errorText = computed(() =>
    extractApiError(chat.value?.error, t('common.error'), {
        unauthorized: t('common.errorUnauthorized'),
        quotaExceeded: t('common.errorQuotaExceeded'),
        rateLimited: t('common.errorRateLimited'),
    }),
);

/**
 * Chat 实例的「归属」标记。
 *
 * transport 里的 conversationId 是 buildChat 那一次调用的闭包值，Chat 自身没有可用来比对的字段，
 * 所以「界面已经切到 B、手里这个实例还是 A」只能靠这个标记查出来——见 handleSubmit 里的第三道比对。
 */
type OwnedChat = Chat<UIMessage> & { __convId: string | null };

function buildChat(convId: string | null, history: UIMessage[] = []): OwnedChat {
    const chat = new Chat<UIMessage>({
        id: convId ?? undefined,
        messages: history,
        transport: new DefaultChatTransport({
            api: apiUrl('/api/chat'),
            headers: (): Record<string, string> => {
                const token = getToken();
                return token ? { Authorization: `Bearer ${token}` } : {};
            },
            prepareSendMessagesRequest: ({ messages }) => ({
                body: { agentId: agentId.value, conversationId: convId ?? undefined, messages },
            }),
        }),
    }) as OwnedChat;
    chat.__convId = convId;
    return chat;
}

async function loadAgentInfo() {
    const token = chatToken;
    try {
        const info = await api<AgentDetail>(`/api/agents/${encodeURIComponent(agentId.value)}`);
        if (token !== chatToken) return;
        agentInfo.value = info;
    } catch (e) {
        if (token !== chatToken) return;
        loadError.value = extractApiError(e, t('common.error'));
    }
}

/** 加载会话列表；返回是否成功，失败不弹出错误只由调用方决定如何呈现（发送后的静默刷新不该打扰） */
async function loadConversations(): Promise<boolean> {
    const token = chatToken;
    try {
        const list = await api<ConversationSummary[]>(`/api/conversations?agentId=${encodeURIComponent(agentId.value)}`);
        if (token === chatToken) conversations.value = list;
        return true;
    } catch {
        if (token === chatToken) conversations.value = [];
        return false;
    }
}

/** 快速切换会话时的过期响应护栏：迟到的响应不得覆盖用户当前选中的会话 */
let chatToken = 0;

async function switchConversation(conv: ConversationSummary) {
    const token = ++chatToken;
    // 换掉旧 Chat 前先停掉在途流：否则旧会话的流会继续消费响应并写回已被替换的对象
    chat.value?.stop();
    conversationId.value = conv.id;
    try {
        const res = await api<{ messages: ChatMessage[] }>(`/api/conversations/${encodeURIComponent(conv.id)}`);
        if (token !== chatToken) return;
        chat.value = buildChat(conv.id, (res.messages ?? []) as unknown as UIMessage[]);
        // 成功切到另一条会话要清掉上一次的历史加载错误，否则错误横幅会残留到新会话
        loadError.value = '';
    } catch (e) {
        if (token !== chatToken) return;
        chat.value = buildChat(conv.id);
        // 历史拉不到也要说明：否则界面只剩一个空会话，会被读成「这个会话没有消息」
        loadError.value = extractApiError(e, t('chat.historyLoadFailed'));
    }
    convModalOpen.value = false;
}

/**
 * 复位成纯本地的新会话（与 Web 端 ChatPane 语义对齐：不预建空会话，首次发送才 POST 建会话）。
 * chatToken 自增让在途的历史响应作废，避免切回草稿时被迟到响应回填。
 */
function resetToDraft() {
    ++chatToken;
    chat.value?.stop();
    conversationId.value = null;
    chat.value = buildChat(null);
    loadError.value = '';
    convModalOpen.value = false;
}

async function startNewConversation() {
    const token = ++chatToken;
    chat.value?.stop();
    try {
        const res = await api<{ id: string }>('/api/conversations', {
            method: 'POST',
            body: JSON.stringify({ agentId: agentId.value }),
        });
        if (token !== chatToken) return;
        conversationId.value = res.id;
        chat.value = buildChat(res.id);
        await loadConversations();
    } catch (e) {
        if (token !== chatToken) return;
        loadError.value = extractApiError(e, t('common.error'));
    }
    convModalOpen.value = false;
}

async function deleteConv(id: string, event: Event) {
    event.stopPropagation();
    if (!(await confirmDialog(t('chat.deleteConfirm')))) return;
    try {
        await api(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadConversations();
        if (conversationId.value === id) {
            if (conversations.value.length > 0) {
                await switchConversation(conversations.value[0]!);
            } else {
                resetToDraft();
            }
        }
    } catch (e) {
        toast(extractApiError(e, t('common.error')));
    }
}

const contentRef = ref<any>(null);
const showScrollBottom = ref(false);
const hasNewMessage = ref(false);
const copiedId = ref<string | null>(null);
const copyFailedId = ref<string | null>(null);
/** 「已复制」提示的复位定时器：页面卸载时清理，避免销毁后写状态（AGENTS 定时器约定） */
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
onUnmounted(() => {
    if (copiedTimer) clearTimeout(copiedTimer);
    // 卸载同样要停在途流：否则离开页面后旧 Chat 仍在消费响应且无法被回收
    chat.value?.stop();
});

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

/** 复制结果的短暂反馈（成功/失败共用一个定时器，1.8 秒后复位） */
function flashCopy(id: string, ok: boolean) {
    copiedId.value = ok ? id : null;
    copyFailedId.value = ok ? null : id;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
        copiedId.value = null;
        copyFailedId.value = null;
    }, 1800);
}

async function copyMessage(m: UIMessage) {
    const texts: string[] = [];
    for (const p of m.parts ?? []) {
        if (p.type === 'text') {
            const text = asText((p as any).text);
            if (text) texts.push(text);
        }
    }
    const content = texts.join('\n');
    if (!content) return;
    try {
        await navigator.clipboard.writeText(content);
        flashCopy(m.id, true);
    } catch {
        // 原生 WebView 里 clipboard 可能因权限或非安全上下文直接 reject。
        // 静默吞掉的界面表现是「点了完全没反应」，用户只会反复点，所以失败也要回一声。
        flashCopy(m.id, false);
    }
}

/** 首载与切智能体共用：复位到草稿态 → 拉新智能体的详情与会话列表 → 进入最新会话或保持草稿 */
async function initForAgent() {
    resetToDraft();
    const token = chatToken;
    pendingAttachments.value = [];
    agentInfo.value = null;
    // 会话列表必须一起清空：loadConversations 是新智能体的，但 Promise.all 返回前弹层里
    // 列出的还是上一个智能体的会话，点进去就会带着旧 conversationId 发消息
    // （头部计数同样在说谎）。服务端现在会拒 400，但入口不该存在。
    conversations.value = [];
    const [convOk] = await Promise.all([loadConversations(), loadAgentInfo()]);
    if (token !== chatToken) return; // 更新的初始化已开始，迟到结果不再续跑
    if (conversations.value.length > 0) {
        await switchConversation(conversations.value[0]!);
    } else {
        // 不预建空会话：首次发送才落库（与 Web ChatPane 同语义）。列表拉取失败时也只是空草稿，不再往库里塞垃圾会话
        resetToDraft();
        if (!convOk && !loadError.value) loadError.value = t('common.loadFailed');
    }
}

onMounted(() => void initForAgent());

// /chat/A → /chat/B 的 SPA 跳转复用本组件（router-outlet 无 :key，setup 不会重跑）：参数变化时整体重载
watch(
    () => route.params.agentId,
    (next) => {
        if (typeof next !== 'string' || !next || next === agentId.value) return;
        agentId.value = next;
        void initForAgent();
    },
);

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

/**
 * 把待发送附件解析成 file part（与 Web ChatPane 的 resolveChatParts 同语义）。
 * 优先走服务端 chat-parts（私有桶回稳定站内路径、公开桶回公共地址）；
 * 接口异常或空返回时回退站内 /raw 路径——虽不如服务端权威，但不会写入会过期的签名地址。
 */
async function resolveChatParts(items: AttachmentRecord[]): Promise<{ type: 'file'; mediaType: string; filename: string; url: string }[]> {
    if (!items.length) return [];
    type ChatFilePart = { type: 'file'; mediaType: string; filename: string; url: string };
    try {
        const res = await api<{ parts: ChatFilePart[] }>('/api/attachments/chat-parts', {
            method: 'POST',
            body: JSON.stringify({ ids: items.map((a) => a.id) }),
        });
        if (res.parts?.length) return res.parts;
    } catch {
        // 失败静默回退，不让附件解析阻塞发送
    }
    return items.map((item) => ({
        type: 'file' as const,
        mediaType: item.mimeType || 'application/octet-stream',
        filename: item.filename,
        url: `/api/attachments/${encodeURIComponent(item.id)}/raw`,
    }));
}

/**
 * 错误横幅上的「重试」直接调 SDK 的 regenerate，绕开了 handleSubmit 的 sending 护栏，
 * 所以自己要把同样的门补上：活动流期间连点会并发发出第二个 /api/chat，两条流交错写同一个
 * Chat 实例、额度多扣一次，而 stop() 只切得断最后那一条。
 * 判据与 Web 端一致用 status !== 'ready'（实测 submitted/streaming 全程成立）。
 */
function handleRegenerate() {
    const current = chat.value;
    if (sending.value || !current || current.status !== 'ready') return;
    void current.regenerate();
}

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
            /**
             * 真正的护栏是 conversationId。原先只判 chat.value，而它在 resetToDraft() 里
             * 就已经被 buildChat(null) 置为非空，等于建会话失败也照样往下发：消息带着空的
             * conversationId 出去，服务端每轮另建一个会话，这段对话被静默切成 N 条，
             * 模型读的库内历史随之断裂，界面上却同时显示错误和已发出的消息。
             * 保留输入与附件直接返回，用户不至于白敲一遍。
             */
            if (!conversationId.value || !chat.value) return;
        }

        // 附件必须经服务端解析：私有桶的预签名地址会过期，不能写进消息历史
        const target = chat.value;
        const targetConversationId = conversationId.value;
        const files = await resolveChatParts(pendingAttachments.value);
        /**
         * 预检 await 期间用户可以从会话列表切走或开新对话：那两步都会换掉 chat.value
         * 与 conversationId。原样往下发就会把在 A 里敲的消息塞进 B（新实例的 transport 带的是
         * B 的 conversationId），既污染了另一段会话的模型上下文，又白扣一次额度。
         * 第三道比对堵的是相反方向的缝：switchConversation 在 216 行就把 conversationId 改成了 B，
         * 而 chat.value 要等历史请求回来（220 行）才换——这个窗口里下滑关掉列表弹窗再点发送，
         * 前两道都成立，消息却会从 A 的实例发出去（transport 闭包带的是 A），
         * 紧接着 B 的历史响应到了又把 A 连同这条流一起丢弃：额度已扣、界面毫无痕迹。
         */
        if (chat.value !== target || conversationId.value !== targetConversationId || target.__convId !== targetConversationId) return;

        input.value = '';
        pendingAttachments.value = [];
        await target.sendMessage(files.length ? { text, files } : { text });
        await loadConversations();
        nextTick(() => scrollToBottom());
    } catch (e) {
        loadError.value = extractApiError(e, t('common.error'));
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
        attachError.value = extractApiError(e, t('common.error'));
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
        const res = await api<AttachmentsResponse>('/api/attachments?pageSize=25');
        attachOptions.value = res.attachments;
    } catch (e) {
        attachError.value = extractApiError(e, t('common.error'));
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

/** 复制当前会话为 Markdown 文本：与 web 端共用 commons 序列化器，文案按当前语言经 t() 传入 */
async function copyConversationMarkdown() {
    if (!chat.value?.messages?.length) {
        toast(t('chat.noMessages'));
        return;
    }
    const currentConv = conversations.value.find((c) => c.id === conversationId.value);
    const title = currentConv?.title || t('chat.newChat');
    const md = formatConversationMarkdown({
        title,
        agentName: agentInfo.value?.name || t('chat.welcomeTitle'),
        model: agentInfo.value?.model || 'default',
        exportTime: formatDateTime(new Date().toISOString(), locale.value),
        messages: chat.value.messages as any,
        labels: {
            doc: t('chat.exportDoc'),
            untitled: t('chat.exportUntitled'),
            agent: t('chat.exportAgent'),
            agentDefault: t('chat.exportAgentDefault'),
            model: t('chat.exportModel'),
            modelDefault: t('chat.exportModelDefault'),
            exportedAt: t('chat.exportExportedAt'),
            user: t('chat.exportRoleUser'),
            reasoning: t('chat.exportReasoning'),
            attachment: t('chat.attachedFile'),
            open: t('chat.exportOpen'),
            toolCall: t('chat.toolCall'),
        },
    });

    try {
        await navigator.clipboard.writeText(md);
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
                        <button
                            type="button"
                            class="app-btn app-btn-ghost !px-2"
                            :title="t('chat.toggleTheme')"
                            :aria-label="t('chat.toggleTheme')"
                            @click="toggleMode"
                        >
                            🌓
                        </button>
                        <button type="button" class="app-btn app-btn-ghost !px-2" :title="t('chat.exportMarkdown')" @click="copyConversationMarkdown">
                            📋
                        </button>
                        <button type="button" class="app-btn app-btn-soft mr-1 !px-2.5" :aria-label="t('nav.conversations')" @click="convModalOpen = true">
                            <span>{{ conversations.length }}</span>
                        </button>
                    </ion-buttons>
                </template>
            </ion-toolbar>
        </ion-header>

        <ion-content ref="contentRef" :scroll-events="true" @ionScroll="onScroll">
            <div class="flex h-full flex-col">
                <!-- 与服务端 position=chat 对齐：管理端选了「对话页」展示位时移动端也要能看到 -->
                <BulletinBanner position="chat" />
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
                                            @click="previewImage = mediaUrl(seg)"
                                        >
                                            <img :src="mediaUrl(seg)" :alt="seg.value" class="max-h-44 object-cover" />
                                        </button>
                                        <a
                                            v-else
                                            :href="mediaUrl(seg)"
                                            target="_blank"
                                            rel="noopener"
                                            class="app-chip max-w-[14rem] !py-1.5"
                                            :title="seg.value"
                                        >
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
                                    :class="[
                                        'mt-1.5 inline-flex items-center gap-1 text-[10px] opacity-70 transition-opacity hover:opacity-100 active:opacity-100',
                                        copyFailedId === m.id ? '!text-[color:var(--danger)]' : '',
                                    ]"
                                    @click="copyMessage(m)"
                                >
                                    <span>
                                        {{
                                            copiedId === m.id
                                                ? '✓ ' + t('common.copied')
                                                : copyFailedId === m.id
                                                  ? '! ' + t('common.copyFailed')
                                                  : '📋 ' + t('common.copy')
                                        }}
                                    </span>
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
                                <button class="mt-2 font-bold underline" @click="handleRegenerate">{{ t('common.retry') }}</button>
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
                                    class="text-faint text-hover-brand ml-2 shrink-0 p-1 text-xs"
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
                        class="bg-brand flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold shadow-lg transition-transform active:scale-95"
                        @click="scrollToBottom"
                    >
                        <span>↓ {{ t('chat.scrollToBottom') }}</span>
                        <span v-if="hasNewMessage" class="flex h-2 w-2 animate-ping rounded-full bg-[color:var(--warning)]" />
                    </button>
                </div>

                <!-- 输入栏 -->
                <div class="sticky bottom-0 p-3" style="border-top: 1px solid var(--line); background-color: var(--surface)">
                    <!-- 待发送附件 -->
                    <div v-if="pendingAttachments.length" class="mb-2 flex flex-wrap gap-2">
                        <span v-for="a in pendingAttachments" :key="a.id" class="app-chip max-w-[13rem] !py-1">
                            <span class="truncate">{{ a.filename }}</span>
                            <span class="text-faint text-[9px]">{{ formatBytes(a.size) }}</span>
                            <button type="button" class="text-faint" :aria-label="t('common.delete')" @click="removePendingAttachment(a.id)">✕</button>
                        </span>
                    </div>
                    <div v-if="attachError" class="app-alert app-alert-danger mb-2 !text-[10px]">{{ attachError }}</div>

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
                            <input
                                v-model="input"
                                :placeholder="t('chat.inputPlaceholder')"
                                :aria-label="t('chat.inputPlaceholder')"
                                class="app-input w-full !pr-7"
                                @keyup.enter="handleSubmit()"
                            />
                            <button
                                v-if="input"
                                type="button"
                                class="text-faint text-hover-strong absolute top-1/2 right-2 -translate-y-1/2 text-xs"
                                :title="t('chat.clearInput')"
                                :aria-label="t('chat.clearInput')"
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
                            <button type="button" class="app-btn app-btn-ghost !px-2" :aria-label="t('common.close')" @click="attachPickerOpen = false">
                                ✕
                            </button>
                        </ion-buttons>
                    </template>
                </ion-toolbar>
            </ion-header>
            <ion-content class="ion-padding">
                <div class="flex gap-2">
                    <button
                        v-if="nativeShell"
                        type="button"
                        class="app-btn app-btn-outline flex-1 !py-2"
                        :disabled="attachUploading"
                        @click="attachFromDevice('photo')"
                    >
                        📷 {{ t('attachments.takePhoto') }}
                    </button>
                    <button type="button" class="app-btn app-btn-outline flex-1 !py-2" :disabled="attachUploading" @click="attachFromDevice('file')">
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

        <!-- 附件图片预览：带 aria-modal 就要自带出口，@click.self 在图片铺满时根本没有可点的地方 -->
        <div
            v-if="previewImage"
            class="app-modal-backdrop"
            role="dialog"
            aria-modal="true"
            :aria-label="t('attachments.preview')"
            @click.self="previewImage = ''"
        >
            <img :src="previewImage" alt="preview" class="max-h-full max-w-full rounded-xl object-contain" />
            <button type="button" class="app-btn app-btn-soft absolute top-4 right-4" :aria-label="t('common.close')" @click="previewImage = ''">✕</button>
        </div>

        <!-- 会话切换弹层 -->
        <ion-modal :is-open="convModalOpen" @did-dismiss="convModalOpen = false">
            <ion-header class="ion-no-border">
                <ion-toolbar>
                    <ion-title class="!text-sm font-black">{{ t('nav.conversations') }}</ion-title>
                    <template v-slot:end>
                        <ion-buttons>
                            <button type="button" class="app-btn app-btn-ghost" :aria-label="t('common.close')" @click="convModalOpen = false">✕</button>
                        </ion-buttons>
                    </template>
                </ion-toolbar>
            </ion-header>
            <ion-content class="ion-padding">
                <button class="app-btn app-btn-primary mb-3 w-full" @click="resetToDraft()">＋ {{ t('chat.newChat') }}</button>
                <ul class="space-y-2">
                    <li v-for="c in conversations" :key="c.id" class="app-card flex items-center justify-between p-3">
                        <button type="button" class="min-w-0 flex-1 text-left" @click="switchConversation(c)">
                            <p class="truncate text-xs font-semibold">{{ c.title }}</p>
                            <p class="text-faint mt-0.5 text-[10px]">{{ formatDate(c.updatedAt) }}</p>
                        </button>
                        <button type="button" class="text-faint ml-2 p-1" :aria-label="t('common.delete')" @click="deleteConv(c.id, $event)">🗑</button>
                    </li>
                    <li v-if="!conversations.length" class="text-faint py-8 text-center text-xs">{{ t('chat.noMessages') }}</li>
                </ul>
            </ion-content>
        </ion-modal>
    </PageShell>
</template>
