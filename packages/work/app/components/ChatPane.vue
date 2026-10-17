<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import { extractApiError, formatBytes, formatDateTime } from '@commons/contract';
import type { AgentDetail, AgentSummary, AttachmentRecord, AttachmentsResponse } from '@commons/contract';
import { DefaultChatTransport, type FileUIPart, type UIMessage } from 'ai';
import { useI18n } from 'vue-i18n';
import { downloadMarkdownFile, formatConversationMarkdown } from '@commons/markdown-export';

/**
 * 对话主视窗：`/chat`（可切换智能体）与 `/chat/:agentId`（固定智能体）共用。
 *
 * 受控设计：智能体（agentId）与当前会话（conversationId）都由父级持有，本组件只负责渲染与交互。
 * - agentId 变化 → 重新取详情（能力徽标 / 导出头部）
 * - conversationId 变成具体 id → 拉历史并重建 Chat 实例；变成 null → 复位成全新对话
 * - 首次发送才会真正落库建会话，然后通过 update:conversationId 交回父级
 *
 * `/chat` 比 `/chat/:agentId` 多一处：传入完整 agentList 时头部出现智能体切换器（切换交回父级决定，
 * 通常意味着开一段新对话）。
 */
const props = withDefaults(
    defineProps<{
        /** 当前绑定的智能体；null 表示`/chat`尚未选择 */
        agentId: string | null;
        /** 当前打开的会话；null 表示全新对话（尚未落库） */
        conversationId?: string | null;
        /** 智能体清单：多于一项时头部渲染切换器 */
        agentList?: AgentSummary[];
        /** 父级已取回的详情（SSR），命中时不再重复请求 */
        initialAgent?: AgentDetail | null;
        /** 外部带进来的草稿（`?ask=`）：非空即填入输入框并聚焦，不自动发送 */
        draft?: string | null;
        /** 侧栏已知的当前会话标题：接管在途实例时不会回源历史，标题只能由父级给 */
        conversationTitle?: string | null;
        /** 新建会话落到哪个工作空间；null 交给服务端落默认空间 */
        spaceId?: string | null;
    }>(),
    { conversationId: null, agentList: () => [], initialAgent: null, draft: null, conversationTitle: null, spaceId: null },
);

const emit = defineEmits<{
    /** 用户在面板里换了智能体：由父级决定是否连带开新对话 */
    'update:agentId': [id: string];
    /** 首次发送建出会话、或点了「新对话」：父级同步自己的高亮状态 */
    'update:conversationId': [id: string | null];
    /** 服务端会话列表可能已变化（新建、自动回填标题）：父级刷新侧栏 */
    'conversation-list-stale': [];
    /** 移动端点头部的历史按钮：会话侧栏 < md 隐藏，由父级打开会话历史抽屉 */
    'open-history': [];
}>();

const { t, locale } = useI18n();

const agent = ref<AgentDetail | null>(props.initialAgent);
const chat = shallowRef<Chat<UIMessage> | null>(null);
/** 已加载的会话 id：用于避免父级同步回同一个 id 时重复拉历史 */
const loadedConversationId = ref<string | null>(null);
const activeConversationTitle = ref('');
/**
 * 侧栏改名后同步标题：面板只在载入历史时取过一次 title，PATCH 成功不会回灌，
 * 于是「改了名再导出」出来的 Markdown 文档标题与文件名还是旧的。只认当前打开的那一段。
 */
const renamedConversation = useState<{ id: string; title: string } | null>('conversation-renamed', () => null);
watch(renamedConversation, (renamed) => {
    if (renamed && renamed.id === loadedConversationId.value) activeConversationTitle.value = renamed.title;
});
/**
 * 侧栏标题是当前会话标题的权威来源：接管在途实例时本组件不回源历史，只能从这里取。
 * 它还会在后台那一轮跑完、服务端回填自动标题后刷新，导出的文件名因此不会停在上一次加载时的旧名字。
 */
watch(
    () => props.conversationTitle,
    (value) => {
        if (!value || loadedConversationId.value !== props.conversationId) return;
        activeConversationTitle.value = value;
    },
);
const input = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);

/**
 * 外部草稿（`/chat?ask=`）：放进输入框并聚焦，让用户改两个字再发。
 * 这里只负责「给我文本我就填」，要不要清掉 URL 由父级决定——它才是深链的消费方。
 */
watch(
    () => props.draft,
    (value) => {
        if (!value) return;
        input.value = value;
        void nextTick(() => inputRef.value?.focus());
    },
    { immediate: true },
);
/** hydration 阶段模板 ref 还没挂上，首屏带进来的草稿要在这里补一次聚焦（否则用户按键就覆盖掉草稿） */
onMounted(() => {
    if (props.draft) void nextTick(() => inputRef.value?.focus());
});

/**
 * 建会话与附件解析都要 await，期间按钮仍是「发送」；连点会重复发送。
 * 与 submitError 必须在 resetLocal 之前声明：下面的 immediate watcher 会调用 resetLocal。
 */
const submitting = ref(false);
/** 发送前的本地错误（如建会话失败）。独立于 chat.error，避免被 AI SDK 的流状态覆盖。 */
const submitError = ref('');

const currentSummary = computed(() => props.agentList.find((item) => item.id === props.agentId) ?? null);
const agentName = computed(() => agent.value?.name || currentSummary.value?.name || t('chat.welcomeTitle'));
const agentEmoji = computed(() => agent.value?.emoji || agent.value?.avatar || currentSummary.value?.emoji || currentSummary.value?.avatar || '🤖');

/** 详情只用于能力徽标与导出头部，取不到不影响对话本身 */
let agentDetailToken = 0;

async function ensureAgentDetail(id: string) {
    if (agent.value?.id === id) return;
    if (props.initialAgent?.id === id) {
        agent.value = props.initialAgent;
        return;
    }
    // 与 loadConversation 同一套护栏：`/chat`切换器连点时，前一个智能体的迟到响应
    // 会把名称/模型/能力徽标盖到刚选中的那个上面（移动端 loadAgentInfo 已有等价逻辑）
    const token = ++agentDetailToken;
    agent.value = null;
    try {
        // id 可能来自路由参数或 localStorage 里的收藏（两者都可被用户改写），
        // 不编进单个路径段就会让 `..%2F..` 之类的取值把请求改写到别的接口上
        const detail = await $fetch<AgentDetail>(`/api/agents/${encodeURIComponent(id)}`);
        if (token !== agentDetailToken) return;
        agent.value = detail;
    } catch {
        if (token !== agentDetailToken) return;
        agent.value = null;
    }
}

/* ---------------- 会话加载 ---------------- */

/**
 * 切会话/切页面**不再**中断在途生成。
 *
 * 旧写法是在丢弃实例前 `stop()`，理由是「实例只是 shallowRef，换掉引用不等于流停了」。
 * 现在这个前提反过来了：实例由 `useChatRuns` 的模块级登记表持住，离开面板时它继续收流、
 * 继续把分片写进自己的 messages，回到这段会话时直接接管，看到的就是接着往下写的那一轮。
 * 真正要中断只剩两个入口：用户点「停止」（模板直接调 `chat.stop()`）与删除会话（`cancelChatRun`）。
 */

let loadToken = 0;

/** 历史加载失败（区别于「空会话」）与快速切换会话时的过期响应护栏 */
const loadError = ref('');
/** 失败的具体会话：重试按钮据此重放，不依赖侧栏当前项 */
const failedConversationId = ref<string | null>(null);
/** 已载入会话所属的智能体：换人后同一个会话 id 也要重新按新归属处理 */
const loadedAgentId = ref<string | null>(null);

function buildChat(conversationId: string, agentId: string, history: UIMessage[] = []) {
    return new Chat<UIMessage>({
        id: conversationId,
        messages: history,
        transport: new DefaultChatTransport({
            api: '/api/chat',
            body: { agentId, conversationId, ...(props.spaceId ? { spaceId: props.spaceId } : {}) },
        }),
    });
}

/**
 * 错误横幅上的「重试」走 SDK 的 regenerate，完全绕开 handleSubmit 里那套并发护栏，
 * 所以自己必须把同样的门补上：活动流期间点它会并发发出第二个 /api/chat——
 * 两条流交错写同一个 Chat 实例，模型调用多烧一次，而 stop() 只切得断最后那一条。
 * 判据与 handleSubmit 一致用 status !== 'ready'（实测 submitted/streaming 全程成立）。
 */
function handleRegenerate() {
    const current = chat.value;
    if (submitting.value || !current || current.status !== 'ready') return;
    void current.regenerate();
}

/**
 * 打开一段会话：优先接管登记表里的实例，否则拉历史新建。
 */
async function loadConversation(id: string) {
    // 只在客户端拉历史：SSR 阶段 `$fetch` 不带请求 cookie，服务端渲染时拉取会 401。
    // 父级因此在 onMounted 之后才决定要打开哪个会话。
    if (import.meta.server) return;
    const agentId = props.agentId;
    if (!agentId) return;

    /**
     * 登记表里有实例就直接接管：它的 messages 已经包含这一轮在途的部分，比数据库历史更新，
     * 再发一次历史请求反而会把正在写的实例换掉（transport 里的 agentId 也要跟着换成当前这个）。
     */
    const cached = adoptChatRun(id);
    if (cached) {
        loadToken += 1;
        loadError.value = '';
        submitError.value = '';
        failedConversationId.value = null;
        chat.value = cached;
        loadedConversationId.value = id;
        loadedAgentId.value = agentId;
        // 接管实例不拉历史，标题得从父级拿；留空会让导出把上一段会话的名字写进文件名
        activeConversationTitle.value = props.conversationTitle || '';
        nextTick(scrollToBottom);
        return;
    }

    const token = ++loadToken;
    loadError.value = '';
    submitError.value = '';
    try {
        const res = await $fetch<{ conversation?: { title?: string }; messages: UIMessage[] }>(`/api/conversations/${encodeURIComponent(id)}`);
        // 迟到的响应可能覆盖用户随后点击的会话，只有最新一次切换可以写入状态
        if (token !== loadToken) return;
        failedConversationId.value = null;
        const next = buildChat(id, agentId, res.messages as UIMessage[]);
        chat.value = next;
        loadedConversationId.value = id;
        loadedAgentId.value = agentId;
        activeConversationTitle.value = res.conversation?.title || '';
        registerChatRun(id, next);
        /**
         * 这一轮可能还在服务端跑（刷新过页面，登记表是空的）。判据是历史最后一条必须是 user：
         * 生成中的那轮回复要到 `onFinish` 才落库，所以「末尾是 user」= 还没有回复 = 可能有在途流。
         * 反过来末尾是 assistant 就说明本轮已经答完并落库，再回放一次会让同一条回复出现两遍。
         * 没有在途轮次时服务端回 204，SDK 把状态复位成 ready，等于免费问一句。
         */
        const last = (res.messages as UIMessage[])[res.messages.length - 1];
        if (last?.role === 'user') void next.resumeStream();
        nextTick(scrollToBottom);
    } catch (e) {
        if (token !== loadToken) return;
        failedConversationId.value = id;
        loadError.value = extractApiError(e, t('common.error'));
    }
}

/** 复位成全新对话：不预建会话，等首次发送时再落库（避免误点产生空会话） */
function resetLocal() {
    loadToken += 1;
    failedConversationId.value = null;
    chat.value = null;
    loadedConversationId.value = null;
    loadedAgentId.value = null;
    activeConversationTitle.value = '';
    loadError.value = '';
    submitError.value = '';
}

/**
 * 父级是「要显示什么」的唯一权威：本组件不去纠正父级状态，只在 props 变化后对齐本地状态。
 *
 * 读的是 agentId 与 conversationId 的组合，而不是分别监听：父级切换会话时两者在同一次 flush 里一起改，
 * 分开监听会看到「新智能体 + 旧会话」这种从未存在过的中间态。只按最终组合决定：有会话就载入，没有就复位。
 */
watch(
    () => [props.agentId, props.conversationId] as const,
    ([agentId, conversationId], previous) => {
        const previousAgentId = previous?.[0] ?? null;
        const previousConversationId = previous?.[1] ?? null;

        if (agentId !== previousAgentId) {
            if (agentId) void ensureAgentDetail(agentId);
            else {
                // 交回父级清空也要作废在途详情，否则迟到的响应会把「未选中」状态又填回一个智能体
                agentDetailToken += 1;
                agent.value = null;
            }
        }

        if (!conversationId) {
            // 全新对话（首屏、点「新对话」、或父级换绑后清空）
            resetLocal();
            return;
        }
        // 只有智能体变了、会话没换：这条会话属于上一个智能体，不能挂到新智能体的 transport 上续聊
        // （服务端会用 400 拒绝 agent 与会话不匹配）。交回父级清空，而不是自作主张改写父级状态。
        if (agentId !== previousAgentId && conversationId === previousConversationId) {
            emit('update:conversationId', null);
            return;
        }
        // 自己刚建出来的会话：本地状态已就绪，不必回源覆盖
        if (loadedConversationId.value === conversationId && loadedAgentId.value === agentId) return;
        void loadConversation(conversationId);
    },
    { immediate: true },
);

/* ---------------- 发送 ---------------- */

async function handleSubmit(overrideText?: string) {
    const text = (overrideText ?? input.value).trim();
    // 允许只发附件（无文字）
    if (!text && !pendingAttachments.value.length) return;
    if (submitting.value) return;
    /**
     * 生成期间不再发第二条。输入框在 <form @submit.prevent> 里，回车始终会提交表单，
     * 而 sending 之类的预检标记只覆盖「建会话/解析附件」那几毫秒——流一旦跑起来就复位了。
     * ai@7 的 Chat 对并发 sendMessage 没有任何去重（实测第二次照样发真实请求）：
     * 于是同一段会话会并行跑出两个 /api/chat，各烧一次真实模型调用、各存一条 assistant 消息，
     * 两条流还往同一个 Chat 实例交错写；此时界面上只有「停止」，而 stop() 只中止最后一条
     * 活动响应，前一条继续跑。判据用 status !== 'ready'（实测 submitted/streaming 全程成立）。
     * 这里直接忽略而不是清空输入：用户的文字要留着，等本轮结束再发。
     */
    if (chat.value && chat.value.status !== 'ready') return;

    const agentId = props.agentId;
    if (!agentId) {
        submitError.value = t('chat.selectAgentFirst');
        return;
    }

    submitting.value = true;
    try {
        // 首次发送时自动创建会话。创建失败必须保留输入内容：
        // 否则用户输入被清空又没发出去，只能重新敲一遍。
        let current = chat.value;
        if (!current) {
            try {
                const created = await $fetch<{ id: string }>('/api/conversations', { method: 'POST', body: { agentId, ...(props.spaceId ? { spaceId: props.spaceId } : {}) } });
                current = buildChat(created.id, agentId);
                chat.value = current;
                registerChatRun(created.id, current);
                loadedConversationId.value = created.id;
                loadedAgentId.value = agentId;
                activeConversationTitle.value = t('chat.newChat');
                emit('update:conversationId', created.id);
                emit('conversation-list-stale');
            } catch (e) {
                submitError.value = extractApiError(e, t('common.error'));
                return;
            }
        }

        const files = await resolveChatParts(pendingAttachments.value);
        /**
         * 建会话与解析附件这两次 await 期间，用户可能点侧栏换到别的会话、或点「新对话」。
         * 那时 chat.value 已被换成（或清成）另一个实例，而 current 是被丢弃的那个 ——
         * AI SDK 不会替被丢弃的实例收尾，在它上面 sendMessage 照样发出真实请求，
         * 于是变成一次「看不见的发送」：模型调用已经起跑、消息落进用户已经离开的那段会话，
         * 界面却停在别处，而输入框马上要被清空。所以清空之前先确认面板没被换走；
         * 换走就放弃这一次，文字与附件都留在输入区，用户看得见、也不需要重敲。
         */
        if (chat.value !== current) return;
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

/** 统一的错误文案（h3 / AI SDK 的错误对象结构差异较大，交给契约层归一化）；兜底文案按当前语言传入 */
const errorText = computed(() =>
    extractApiError(chat.value?.error, t('common.error'), {
        unauthorized: t('common.errorUnauthorized'),
        rateLimited: t('common.errorRateLimited'),
    }),
);

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

watch(
    () => chat.value?.status,
    (status, previous) => {
        // 流结束后服务端已按首条用户消息回填标题，通知父级刷新侧栏
        if (status === 'ready' && (previous === 'streaming' || previous === 'submitted')) emit('conversation-list-stale');
    },
);

// 面板销毁时**不**中断在途生成：实例留在 `useChatRuns` 的登记表里继续收流，
// 用户切回这段会话时接管同一个实例（路由切走等于组件卸载，过去这里会 stop()，
// 于是「离开聊天页」本身就把一轮已经烧掉 token 的生成掐掉了）。

/**
 * 「停止」按钮：本地断流 + 让服务端也中止这一轮。
 *
 * `chat.stop()` 只断开浏览器这条 fetch；服务端的模型调用照常跑完并落库（后台续跑依赖的正是这个行为），
 * 所以只调它等于「看不见但照烧」。`stopChatRun` 会另发 `POST /api/chat/{会话 id}/stop`。
 */
function stopGeneration() {
    const id = loadedConversationId.value;
    chat.value?.stop();
    if (id) void stopChatRun(id);
}

/* ---------------- 滚动 ---------------- */

const showScrollBottom = ref(false);
const hasNewMessage = ref(false);

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

/* ---------------- 附件 ---------------- */

/** 待发送的附件（发送成功后清空；失败时保留，避免用户重选） */
const pendingAttachments = ref<AttachmentRecord[]>([]);
const attachPickerOpen = ref(false);
/** 附件弹层的键盘可达性：Esc 关、Tab 圈闭、滚动锁与焦点归还（与 AdminDrawer 同一套行为） */
const attachPickerPanel = ref<HTMLElement | null>(null);
useDrawerFocus(
    () => attachPickerOpen.value,
    attachPickerPanel,
    () => {
        attachPickerOpen.value = false;
    },
);
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
        url: `/api/attachments/${encodeURIComponent(item.id)}/raw`,
    }));
}

/** 打开附件选择器：拉取最近上传的附件供选择 */
async function openAttachPicker() {
    attachPickerOpen.value = true;
    attachLoading.value = true;
    attachError.value = '';
    try {
        const res = await $fetch<AttachmentsResponse>('/api/attachments', { query: { pageSize: 25 } });
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

/** 聊天里直接选本地文件：走服务端中转上传，上传完即挂到这一轮，不需要先经过任何页面 */
async function onChatFileChange(event: Event) {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    // 已经挂满 5 个时先拦下：继续上传会把整份文件写进桶与附件表，最后却只换来一句「已达上限」，
    // 而那个对象从此只存在于附件总览里（聊天这一轮并没有用它）。
    if (pendingAttachments.value.length >= 5) {
        attachError.value = t('chat.attachLimit');
        return;
    }
    uploadingInChat.value = true;
    attachError.value = '';
    try {
        const form = new FormData();
        form.append('file', file);
        form.append('category', 'chat');
        const created = await $fetch<AttachmentRecord>('/api/attachments', { method: 'POST', body: form });
        // 上传期间用户可能已挂上别的附件：到上限就只提示，不再塞进待发送区
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

/* ---------------- 智能体切换与导出 ---------------- */

const agentPickerOpen = ref(false);
const agentPickerPanel = ref<HTMLElement | null>(null);
useDrawerFocus(
    () => agentPickerOpen.value,
    agentPickerPanel,
    () => {
        agentPickerOpen.value = false;
    },
);
const agentSearch = ref('');

const filteredAgentOptions = computed(() => {
    const q = agentSearch.value.trim().toLowerCase();
    if (!q) return props.agentList;
    return props.agentList.filter((item) => item.name.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q));
});

const switchable = computed(() => props.agentList.length > 1);

function openAgentPicker() {
    agentSearch.value = '';
    agentPickerOpen.value = true;
}

/** 换智能体：已产生的会话不能换人续聊，交给父级同时把 conversationId 清空 */
function selectAgent(id: string) {
    agentPickerOpen.value = false;
    if (id === props.agentId) return;
    emit('update:agentId', id);
}

// 导出当前对话为 Markdown 文件
function exportMarkdown() {
    const messages = chat.value?.messages ?? [];
    if (!messages.length) {
        // 按钮本就由 v-if="chat?.messages?.length" 隐藏，这里是「点击瞬间实例被切成空会话」的竞态兜底，
        // 就地 return 即可，不需要再弹原生 alert
        return;
    }
    const title = activeConversationTitle.value || t('chat.newChat');
    const md = formatConversationMarkdown({
        title,
        agentName: agentName.value,
        model: agent.value?.model || '',
        exportTime: formatDateTime(new Date().toISOString(), locale.value),
        messages: messages as any,
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
    downloadMarkdownFile(`${title}_${new Date().toISOString().slice(0, 10)}`, md);
}

const starterPrompts = computed(() => [t('chat.starterPrompts.0'), t('chat.starterPrompts.1'), t('chat.starterPrompts.2')]);
</script>

<template>
    <section class="app-card relative flex min-w-0 flex-1 flex-col overflow-hidden !rounded-2xl">
        <!-- 顶部信息条：智能体（`/chat`可切换）+ 导出 / 新对话 -->
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
                    @click="openAgentPicker"
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
                            @click="openAgentPicker"
                        >
                            <span class="truncate">{{ agentName }}</span>
                            <AppIcon name="chevron-down" :size="15" class="shrink-0" />
                        </button>
                        <h2 v-else class="truncate text-sm font-bold">{{ agentName }}</h2>

                        <!-- 模型名只在真知道时展示：此前回退成 'deepseek-chat'，详情还没到或该智能体没填模型时
                             会向用户宣称一个它并不在用的模型 -->
                        <span v-if="agent?.model" class="app-chip font-mono">{{ agent.model }}</span>
                        <span v-if="agent?.temperature !== null && agent?.temperature !== undefined" class="app-chip app-chip-brand">
                            Temp {{ agent.temperature }}
                        </span>
                        <span v-if="agent?.tools?.length" class="app-chip"> 🛠️ {{ agent.tools.length }} </span>
                        <span v-if="agent?.skills?.length" class="app-chip"> 🧩 {{ agent.skills.length }} </span>
                        <span v-if="agent?.knowledgeBases?.length" class="app-chip" :title="agent.knowledgeBases.map((k) => k.name).join('、')">
                            📚 {{ agent.knowledgeBases.length }}
                        </span>
                        <span v-if="agent?.mcpServers?.length" class="app-chip" :title="agent.mcpServers.map((m) => m.name).join('、')">
                            🔌 {{ agent.mcpServers.length }}
                        </span>
                    </div>
                    <p class="text-faint truncate text-[11px]">{{ agent?.description || currentSummary?.description || t('chat.welcomeDesc') }}</p>
                </div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
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
                <button type="button" class="app-btn app-btn-ghost !px-2.5 !py-1.5" :title="t('chat.newChat')" @click="emit('update:conversationId', null)">
                    ＋
                </button>
            </div>
        </div>

        <!-- 消息列表与冷启动卡片 -->
        <div ref="scrollRef" class="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" style="background-color: var(--surface-2)" @scroll="onScroll">
            <template v-if="chat && chat.messages.length > 0">
                <ChatMessage v-for="m in chat.messages" :key="m.id" :message="m" />
                <div v-if="chat.status === 'submitted'" class="text-faint flex items-center gap-2 py-2 text-xs" role="status">
                    <span class="inline-block animate-spin" aria-hidden="true">🌀</span>
                    <span>{{ t('chat.thinking') }}</span>
                </div>

                <!-- 生成失败：给出可读原因与重试入口。role="alert" 让读屏立刻念出原因，
                     否则右上角的流式样式变化是唯一反馈，视觉之外无从得知这一轮已经失败 -->
                <div v-if="chat.error" class="app-alert-danger rounded-2xl border p-4 text-xs" role="alert">
                    <div class="flex items-center justify-between">
                        <span>{{ errorText }}</span>
                        <button class="font-bold underline" @click="handleRegenerate">{{ t('common.retry') }}</button>
                    </div>
                </div>
            </template>

            <!-- 冷启动空状态：未选智能体时先选人，否则展示欢迎卡片与引导提示词 -->
            <div v-else class="flex h-full flex-col items-center justify-center py-10 text-center">
                <template v-if="!props.agentId">
                    <div class="app-avatar-icon h-16 w-16 !rounded-3xl text-3xl">🤖</div>
                    <h3 class="mt-3 text-base font-bold">{{ t('chat.pickAgentTitle') }}</h3>
                    <p class="text-faint mt-1 max-w-sm text-xs">{{ t('chat.pickAgentDesc') }}</p>
                    <button v-if="switchable" type="button" class="app-btn app-btn-primary mt-5" @click="openAgentPicker">
                        {{ t('chat.selectAgent') }}
                    </button>
                </template>
                <template v-else>
                    <div class="app-avatar-icon h-16 w-16 !rounded-3xl text-3xl">{{ agentEmoji }}</div>
                    <h3 class="mt-3 text-base font-bold">{{ t('chat.welcomeTitle') }} · {{ agentName }}</h3>
                    <p class="text-faint mt-1 max-w-sm text-xs">
                        {{ agent?.description || currentSummary?.description || t('chat.welcomeDesc') }}
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
                                class="app-hover-reveal text-faint text-hover-brand ml-2 block shrink-0 rounded p-1 text-xs"
                                :title="t('chat.usePrompt')"
                                :aria-label="t('chat.usePrompt')"
                                @click="fillPrompt(prompt)"
                            >
                                ✏️
                            </button>
                        </div>
                    </div>
                </template>
            </div>
        </div>

        <!-- 回到底部悬浮微按钮 -->
        <div v-if="showScrollBottom" class="absolute right-6 bottom-24 z-20 transition-all duration-200">
            <button
                type="button"
                class="bg-primary-600 hover:bg-primary-700 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-[color:var(--on-brand)] shadow-md transition-transform active:scale-95"
                @click="scrollToBottom"
            >
                <span>↓ {{ t('chat.scrollToBottom') }}</span>
                <span v-if="hasNewMessage" class="flex h-2 w-2 animate-ping rounded-full bg-[color:var(--warning)]" />
            </button>
        </div>

        <!-- 发送前本地错误（建会话失败）与会话历史加载失败：不渲染就会被误当成空会话 -->
        <div v-if="submitError || loadError" class="app-alert app-alert-danger" role="alert">
            <div class="flex items-center justify-between gap-3">
                <span>{{ submitError || loadError }}</span>
                <button
                    v-if="loadError && !submitError && failedConversationId"
                    type="button"
                    class="font-bold underline"
                    @click="loadConversation(failedConversationId)"
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
                    <button type="button" class="text-faint text-hover-strong -m-1 p-1.5" :title="t('common.delete')" @click="removePending(a.id)">✕</button>
                </span>
            </div>
            <div v-if="attachError" class="app-alert app-alert-danger mb-2 !text-[11px]" role="alert">{{ attachError }}</div>

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
                    <input
                        ref="inputRef"
                        v-model="input"
                        :placeholder="t('chat.inputPlaceholder')"
                        :aria-label="t('chat.inputPlaceholder')"
                        class="app-input !pr-8"
                    />
                    <button
                        v-if="input"
                        type="button"
                        class="text-faint text-hover-strong absolute top-1/2 right-1.5 -translate-y-1/2 p-1.5 text-xs"
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
                    @click="stopGeneration"
                >
                    {{ t('chat.stop') }}
                </button>
                <button v-else type="submit" class="app-btn app-btn-primary !px-6" :disabled="submitting">
                    {{ t('chat.send') }}
                </button>
            </div>
            <div class="text-faint mt-1.5 flex items-center justify-between px-1 text-[11px] select-none">
                <span>💡 {{ t('chat.shortcutHint') }}</span>
                <span v-if="input.length > 0">{{ t('chat.charCount', { n: input.length }) }}</span>
            </div>
        </form>

        <!-- 附件选择弹层：列最近上传的附件，也可直接上传新文件 -->
        <Teleport to="body">
            <div
                v-if="attachPickerOpen"
                ref="attachPickerPanel"
                class="app-modal-backdrop"
                role="dialog"
                aria-modal="true"
                :aria-label="t('chat.attach')"
                @click.self="attachPickerOpen = false"
            >
                <div class="app-card w-full max-w-lg p-5">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-black">{{ t('chat.attach') }}</h3>
                        <button type="button" class="text-faint text-hover-strong" :aria-label="t('common.close')" @click="attachPickerOpen = false">✕</button>
                    </div>

                    <div class="mt-3 flex gap-2">
                        <button type="button" class="app-btn app-btn-outline !py-1.5" :disabled="uploadingInChat" @click="chatFileInput?.click()">
                            <AppIcon name="tray-arrow-up" :size="14" />
                            <span>{{ uploadingInChat ? t('attachments.uploading') : t('chat.uploadAndAttach') }}</span>
                        </button>
                    </div>

                    <!-- 弹层是 Teleport 到 body 的：输入栏那条 attachError 被遮罩盖在身后，
                         从弹层里上传失败时用户眼前没有任何反馈，看起来像按钮没反应 -->
                    <div v-if="attachError" class="app-alert app-alert-danger mt-3 !text-[11px]" role="alert">{{ attachError }}</div>

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

        <!-- 智能体选择弹层（`/chat`）：切换即开一段新对话 -->
        <Teleport to="body">
            <div
                v-if="agentPickerOpen"
                ref="agentPickerPanel"
                class="app-modal-backdrop"
                role="dialog"
                aria-modal="true"
                :aria-label="t('chat.selectAgent')"
                @click.self="agentPickerOpen = false"
            >
                <div class="app-card w-full max-w-lg p-5">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-black">{{ t('chat.selectAgent') }}</h3>
                        <button type="button" class="text-faint text-hover-strong" :aria-label="t('common.close')" @click="agentPickerOpen = false">✕</button>
                    </div>

                    <input v-model="agentSearch" :aria-label="t('chat.searchAgent')" class="app-input mt-3 !text-xs" :placeholder="t('chat.searchAgent')" />

                    <div v-if="filteredAgentOptions.length" class="mt-3 max-h-80 space-y-2 overflow-y-auto">
                        <button
                            v-for="item in filteredAgentOptions"
                            :key="item.id"
                            type="button"
                            class="app-card app-card-hover flex w-full items-center gap-3 p-2.5 text-left"
                            :class="item.id === agentId ? 'app-card-brand' : ''"
                            @click="selectAgent(item.id)"
                        >
                            <span class="app-avatar-icon h-8 w-8 shrink-0 text-lg">{{ item.emoji || item.avatar || '🤖' }}</span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-xs font-bold">{{ item.name }}</span>
                                <span class="text-faint block truncate text-[10px]">{{ item.description || t('common.none') }}</span>
                            </span>
                            <span v-if="item.id === agentId" class="app-badge app-badge-success shrink-0 !text-[10px]">
                                {{ t('common.confirm') }}
                            </span>
                        </button>
                    </div>
                    <p v-else class="text-faint mt-3 py-8 text-center text-xs">{{ t('agents.noAgents') }}</p>
                </div>
            </div>
        </Teleport>
    </section>
</template>
