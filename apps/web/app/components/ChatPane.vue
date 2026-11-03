<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import { Markdown } from '@comark/vue';
import { extractApiError, formatBytes, formatDateTime } from '@commons/contract';
import type { AgentDetail, AgentSummary, AttachmentRecord, AttachmentsResponse } from '@commons/contract';
import { DefaultChatTransport, type FileUIPart, type UIMessage } from 'ai';
import { useI18n } from 'vue-i18n';
import { downloadMarkdownFile, formatConversationMarkdown } from '@commons/markdown-export';
import { chatErrorHintKey } from '../utils/chat-error';

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
        /** 新建会话落到哪个工作空间；null 表示独立对话 */
        spaceId?: string | null;
        /** 当前会话/新建目标的空间名，用于头部归属提示 */
        spaceName?: string | null;
    }>(),
    { conversationId: null, agentList: () => [], initialAgent: null, draft: null, conversationTitle: null, spaceId: null, spaceName: null },
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
const inputRef = ref<HTMLTextAreaElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);

/**
 * 工具审批（P1-4）：审批在服务端把工具 execute 挂起，前端只轮询当前会话的 pending 行。
 * 只轮询「有具体会话」的面板，空闲时不发请求；流结束后没有 pending 也会自然停在一张卡片上。
 */
interface PendingApproval {
    id: string;
    toolName: string;
    risk: string;
    payload?: Record<string, unknown> | null;
    createdAt?: string;
}
const pendingApproval = ref<PendingApproval | null>(null);
let approvalTimer: ReturnType<typeof setInterval> | null = null;

async function refreshApproval() {
    if (!props.conversationId) {
        pendingApproval.value = null;
        return;
    }
    try {
        const data = await $fetch<{ approvals: PendingApproval[] }>('/api/approvals', {
            query: { conversationId: props.conversationId, status: 'pending', limit: 1 },
        });
        pendingApproval.value = data.approvals[0] ?? null;
    } catch {
        // 审批轮询失败不能打断聊天；下一轮再试
    }
}

function stopApprovalPolling() {
    if (approvalTimer) clearInterval(approvalTimer);
    approvalTimer = null;
}

function startApprovalPolling() {
    stopApprovalPolling();
    if (!import.meta.client || !props.conversationId) return;
    void refreshApproval();
    approvalTimer = setInterval(() => void refreshApproval(), 2000);
}

function onApprovalDecided() {
    pendingApproval.value = null;
    void refreshApproval();
}

watch(() => props.conversationId, startApprovalPolling, { immediate: true });
onUnmounted(stopApprovalPolling);

interface ContextInfo {
    source: 'events' | 'messages';
    compacted: boolean;
    messageCount: number;
    estimatedTokens: number;
    budget: number;
    percent: number;
}
const contextInfo = ref<ContextInfo | null>(null);
const compacting = ref(false);
const compactNotice = ref('');

async function refreshContext() {
    if (!props.conversationId || import.meta.server) return;
    try {
        contextInfo.value = await $fetch<ContextInfo>(`/api/conversations/${encodeURIComponent(props.conversationId)}/context`);
    } catch {
        // 上下文面板是观测信息，失败不打断聊天
    }
}

interface TodoItem {
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'completed';
    note?: string;
}
interface GoalInfo {
    id: string;
    objective: string;
    status: 'active' | 'paused' | 'completed' | 'blocked';
    revision: number;
    round: number;
    maxRounds: number;
}
const todoItems = ref<TodoItem[]>([]);
const goal = ref<GoalInfo | null>(null);
const planMode = ref(false);
const assistBusy = ref(false);
const todoError = ref('');

async function refreshAssist() {
    if (!props.conversationId || import.meta.server) return;
    const id = encodeURIComponent(props.conversationId);
    try {
        const [todo, goalResult] = await Promise.all([
            $fetch<{ items: TodoItem[] }>(`/api/conversations/${id}/todos`),
            $fetch<{ goal: GoalInfo | null; planMode: boolean }>(`/api/conversations/${id}/goal`),
        ]);
        todoItems.value = todo.items ?? [];
        goal.value = goalResult.goal ?? null;
        planMode.value = goalResult.planMode ?? false;
    } catch {
        // 待办/目标是辅助信息，失败不打断聊天
    }
}

async function togglePlanMode() {
    if (!props.conversationId || assistBusy.value) return;
    assistBusy.value = true;
    todoError.value = '';
    try {
        const result = await $fetch<{ planMode: boolean }>(`/api/conversations/${encodeURIComponent(props.conversationId)}/plan-mode`, {
            method: 'PUT',
            body: { enabled: !planMode.value },
        });
        planMode.value = result.planMode;
    } catch (error) {
        todoError.value = extractApiError(error, t('chat.planModeFailed'));
    } finally {
        assistBusy.value = false;
    }
}

async function saveTodos(items: TodoItem[]) {
    if (!props.conversationId || assistBusy.value) return;
    assistBusy.value = true;
    todoError.value = '';
    try {
        const result = await $fetch<{ items: TodoItem[] }>(`/api/conversations/${encodeURIComponent(props.conversationId)}/todos`, {
            method: 'PUT',
            body: { items },
        });
        todoItems.value = result.items ?? [];
    } catch (error) {
        todoError.value = extractApiError(error, t('chat.todoSaveFailed'));
    } finally {
        assistBusy.value = false;
    }
}

function toggleTodo(item: TodoItem) {
    const status = item.status === 'completed' ? 'pending' : 'completed';
    void saveTodos(todoItems.value.map((entry) => (entry.id === item.id ? { ...entry, status } : entry)));
}

async function continueGoal() {
    if (!props.conversationId || assistBusy.value || !goal.value) return;
    assistBusy.value = true;
    try {
        const result = await $fetch<{ goal: GoalInfo }>(`/api/conversations/${encodeURIComponent(props.conversationId)}/goal/continue`, {
            method: 'POST',
        });
        goal.value = result.goal;
    } catch (error) {
        todoError.value = extractApiError(error, t('chat.goalContinueFailed'));
    } finally {
        assistBusy.value = false;
    }
}

async function compactConversation() {
    if (!props.conversationId || compacting.value) return;
    compacting.value = true;
    compactNotice.value = '';
    try {
        const result = await $fetch<{ compacted: boolean; reason?: string; tokensBefore?: number; tokensAfter?: number }>(
            `/api/conversations/${encodeURIComponent(props.conversationId)}/compact`,
            { method: 'POST' },
        );
        if (!result.compacted) {
            compactNotice.value =
                result.reason === 'below_threshold'
                    ? t('chat.compactBelow')
                    : result.reason === 'already_running'
                      ? t('chat.compactRunning')
                      : t('chat.compactFailed');
            return;
        }
        compactNotice.value = t('chat.compactDone', { before: result.tokensBefore ?? 0, after: result.tokensAfter ?? 0 });
        // 强制回源：缓存实例里还是压缩前的消息，不换实例就看不到摘要
        await loadConversation(props.conversationId, true);
        await refreshContext();
    } catch (error) {
        compactNotice.value = extractApiError(error, t('chat.compactFailed'));
    } finally {
        compacting.value = false;
    }
}

watch(
    () => props.conversationId,
    (id) => {
        contextInfo.value = null;
        compactNotice.value = '';
        todoItems.value = [];
        goal.value = null;
        planMode.value = false;
        todoError.value = '';
        if (id) {
            void refreshContext();
            void refreshAssist();
        }
    },
    { immediate: true },
);
watch(
    () => chat.value?.status,
    (status) => {
        if (status === 'ready') {
            void refreshContext();
            void refreshAssist();
        }
    },
);

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
const headerDescription = computed(() => agent.value?.description || currentSummary.value?.description || '');

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

function buildChat(conversationId: string, agentId: string, history: UIMessage[] = [], spaceId: string | null = props.spaceId) {
    return new Chat<UIMessage>({
        id: conversationId,
        messages: history,
        transport: new DefaultChatTransport({
            api: '/api/chat',
            body: { agentId, conversationId, ...(spaceId ? { spaceId } : {}) },
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
async function loadConversation(id: string, force = false) {
    // 只在客户端拉历史：SSR 阶段 `$fetch` 不带请求 cookie，服务端渲染时拉取会 401。
    // 父级因此在 onMounted 之后才决定要打开哪个会话。
    if (import.meta.server) return;
    const agentId = props.agentId;
    if (!agentId) return;

    /**
     * 登记表里有实例就直接接管：它的 messages 已经包含这一轮在途的部分，比数据库历史更新，
     * 再发一次历史请求反而会把正在写的实例换掉（transport 里的 agentId 也要跟着换成当前这个）。
     */
    const cached = force ? null : adoptChatRun(id);
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

async function discardCreatedConversation(id: string) {
    try {
        await $fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
        // 清理失败不覆盖用户眼前这次发送的结论；下一次刷新会话列表时仍可人工删除
    }
}

async function handleSubmit(overrideText?: string) {
    const text = (overrideText ?? input.value).trim();
    if (!text && !pendingAttachments.value.length) return;
    if (submitting.value || uploadingInChat.value) return;
    if (chat.value && chat.value.status !== 'ready') return;

    const agentId = props.agentId;
    const spaceId = props.spaceId;
    if (!agentId) {
        submitError.value = t('chat.selectAgentFirst');
        return;
    }

    submitting.value = true;
    try {
        // 先解析附件再建会话：空间切换发生在附件上传/解析期间时，不留下一条空会话。
        const instanceBeforeResolve = chat.value;
        const files = await resolveChatParts(pendingAttachments.value);
        if (chat.value !== instanceBeforeResolve || props.spaceId !== spaceId) return;

        let current = chat.value;
        if (!current) {
            try {
                const generationToken = loadToken;
                const created = await $fetch<{ id: string }>('/api/conversations', {
                    method: 'POST',
                    body: { agentId, ...(spaceId ? { spaceId } : {}) },
                });
                if (props.spaceId !== spaceId || loadToken !== generationToken) {
                    await discardCreatedConversation(created.id);
                    return;
                }
                current = buildChat(created.id, agentId, [], spaceId);
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

        if (chat.value !== current) return;
        input.value = '';
        pendingAttachments.value = [];
        submitError.value = '';
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
const errorHint = computed(() => {
    const key = chatErrorHintKey(chat.value?.error);
    return key ? t(key) : '';
});
const localErrorHint = computed(() => {
    const key = chatErrorHintKey(submitError.value || loadError.value);
    return key ? t(key) : '';
});

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
let attachPickerToken = 0;
const attachError = ref('');

// 切换空间后，旧空间的待发送附件不能跟着进入新空间的会话。
watch(
    () => props.spaceId,
    (next, previous) => {
        if (next === previous) return;
        pendingAttachments.value = [];
        attachOptions.value = [];
        attachError.value = '';
        submitError.value = '';
        if (loadedConversationId.value) emit('update:conversationId', null);
    },
);
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
    const token = ++attachPickerToken;
    attachPickerOpen.value = true;
    attachLoading.value = true;
    attachError.value = '';
    try {
        const res = await $fetch<AttachmentsResponse>('/api/attachments', { query: { pageSize: 25, spaceId: props.spaceId || undefined } });
        if (token === attachPickerToken) attachOptions.value = res.attachments;
    } catch (e) {
        if (token !== attachPickerToken) return;
        attachOptions.value = [];
        attachError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        if (token === attachPickerToken) attachLoading.value = false;
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
    const uploadSpaceId = props.spaceId;
    try {
        const form = new FormData();
        form.append('file', file);
        form.append('category', 'chat');
        if (uploadSpaceId) form.append('spaceId', uploadSpaceId);
        const created = await $fetch<AttachmentRecord>('/api/attachments', { method: 'POST', body: form });
        // 上传期间用户切了空间：附件已落到旧空间，不能把它挂进新对话的待发送区
        if (props.spaceId !== uploadSpaceId) return;
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

/* ---------------- 工作台右侧检视栏（Context & Artifact Inspector）与消息沉淀 ---------------- */

const router = useRouter();
const inspectorOpen = ref(false);
const inspectorTab = ref<'context' | 'artifact' | 'todo' | 'timeline'>('context');
const inspectedText = ref('');
const artifactCopied = ref(false);
interface ArtifactItem {
    id: string;
    title: string;
    path: string;
    mimeType: string;
    size: number;
    createdAt: string;
}
const artifacts = ref<ArtifactItem[]>([]);

async function loadArtifacts() {
    if (import.meta.server || !props.conversationId) {
        artifacts.value = [];
        return;
    }
    try {
        const result = await $fetch<{ artifacts: ArtifactItem[] }>(`/api/conversations/${encodeURIComponent(props.conversationId)}/artifacts`);
        artifacts.value = Array.isArray(result.artifacts) ? result.artifacts : [];
    } catch {
        artifacts.value = [];
    }
}

function selectInspectorTab(tab: 'context' | 'artifact' | 'todo' | 'timeline') {
    inspectorTab.value = tab;
    if (tab === 'artifact') void loadArtifacts();
}

watch(
    () => props.conversationId,
    () => {
        artifacts.value = [];
        if (inspectorOpen.value && inspectorTab.value === 'artifact') void loadArtifacts();
    },
);

const latestAssistantText = computed(() => {
    const msgs = chat.value?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m?.role === 'assistant' && Array.isArray(m.parts)) {
            const text = m.parts
                .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
                .map((p: any) => p.text)
                .join('\n')
                .trim();
            if (text) return text;
        }
    }
    return '';
});

const effectiveArtifactText = computed(() => inspectedText.value || latestAssistantText.value);

function openArtifactInspector(payload: { text: string }) {
    inspectedText.value = payload.text;
    inspectorTab.value = 'artifact';
    inspectorOpen.value = true;
    void loadArtifacts();
}

async function copyArtifactText() {
    if (!effectiveArtifactText.value) return;
    try {
        await navigator.clipboard.writeText(effectiveArtifactText.value);
        artifactCopied.value = true;
        setTimeout(() => {
            artifactCopied.value = false;
        }, 1800);
    } catch {
        // ignore
    }
}

function downloadArtifactMarkdown() {
    if (!effectiveArtifactText.value) return;
    const title = activeConversationTitle.value || t('chat.newChat');
    downloadMarkdownFile(`${title}_artifact`, effectiveArtifactText.value);
}

function turnMessageIntoSchedule(payload: { text: string; role: string }) {
    const clean = payload.text.trim();
    if (!clean) return;
    const firstLine =
        clean
            .split('\n')[0]
            ?.replace(/^[#*\-\s]+/, '')
            .trim()
            .slice(0, 40) || t('chat.newChat');
    void router.push({
        path: '/tasks',
        query: {
            new: '1',
            title: firstLine,
            prompt: clean.slice(0, 2000),
            ...(props.agentId ? { agentId: props.agentId } : {}),
            ...(props.spaceId ? { spaceId: props.spaceId } : {}),
        },
    });
}

// 一键将消息/产物存入知识库
interface KbOption {
    id: string;
    name: string;
    spaceId: string | null;
}
const saveKbOpen = ref(false);
const saveKbOptions = ref<KbOption[]>([]);
const saveKbTargetId = ref('');
const saveKbTitle = ref('');
const saveKbContent = ref('');
const saveKbBusy = ref(false);
const saveKbError = ref('');
const saveKbSuccess = ref('');

async function openSaveKnowledgeModal(payload: { text: string; role?: string }) {
    const clean = payload.text.trim();
    if (!clean) return;
    saveKbContent.value = clean;
    const firstLine =
        clean
            .split('\n')[0]
            ?.replace(/^[#*\-\s]+/, '')
            .trim()
            .slice(0, 60) ||
        activeConversationTitle.value ||
        t('chat.newChat');
    saveKbTitle.value = firstLine;
    saveKbError.value = '';
    saveKbSuccess.value = '';
    saveKbOpen.value = true;
    try {
        const rows = await $fetch<KbOption[]>('/api/settings/knowledge-bases', {
            query: props.spaceId ? { spaceId: props.spaceId } : undefined,
        });
        saveKbOptions.value = rows;
        saveKbTargetId.value = rows[0]?.id ?? '';
    } catch {
        saveKbOptions.value = [];
    }
}

async function submitSaveKnowledge() {
    if (!saveKbContent.value.trim()) return;
    saveKbBusy.value = true;
    saveKbError.value = '';
    try {
        let kbId = saveKbTargetId.value;
        if (!kbId) {
            const created = await $fetch<{ id: string }>('/api/settings/knowledge-bases', {
                method: 'POST',
                body: {
                    name: props.spaceName ? `${props.spaceName} 知识库` : t('chat.defaultKbName'),
                    description: t('chat.defaultKbDesc'),
                    spaceId: props.spaceId || null,
                    embeddingModel: 'text-embedding-3-small',
                },
            });
            kbId = created.id;
        }
        await $fetch(`/api/settings/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
            method: 'POST',
            body: {
                title: saveKbTitle.value.trim() || t('chat.newChat'),
                content: saveKbContent.value,
            },
        });
        saveKbOpen.value = false;
        saveKbSuccess.value = t('chat.saveToKnowledgeSuccess');
        setTimeout(() => {
            saveKbSuccess.value = '';
        }, 3500);
    } catch (e) {
        saveKbError.value = extractApiError(e, t('common.saveFailed'));
    } finally {
        saveKbBusy.value = false;
    }
}

function insertSkillPrompt(skillName: string) {
    const prefix = `/${skillName} `;
    if (!input.value.startsWith(prefix)) {
        input.value = `${prefix}${input.value}`;
    }
    void nextTick(() => inputRef.value?.focus());
}

function onInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void handleSubmit();
    }
}
</script>

<template>
    <section class="app-card relative flex min-w-0 flex-1 flex-col overflow-hidden !rounded-2xl">
        <ChatHeader
            :agent-emoji="agentEmoji"
            :agent-name="agentName"
            :description="headerDescription"
            :space-name="props.spaceName"
            :model="agent?.model"
            :temperature="agent?.temperature"
            :tool-count="agent?.tools?.length ?? 0"
            :skill-count="agent?.skills?.length ?? 0"
            :knowledge-count="agent?.knowledgeBases?.length ?? 0"
            :mcp-count="agent?.mcpServers?.length ?? 0"
            :switchable="switchable"
            :has-messages="Boolean(chat?.messages?.length)"
            :inspector-open="inspectorOpen"
            @open-history="emit('open-history')"
            @open-agent-picker="openAgentPicker"
            @export="exportMarkdown"
            @toggle-inspector="inspectorOpen = !inspectorOpen"
            @new-chat="emit('update:conversationId', null)"
        />

        <div
            v-if="saveKbSuccess"
            class="flex items-center justify-between border-b px-4 py-2 text-xs font-semibold"
            style="border-color: var(--line); background-color: var(--brand-soft); color: var(--brand)"
        >
            <span>✓ {{ saveKbSuccess }}</span>
            <button type="button" class="text-xs opacity-70 hover:opacity-100" @click="saveKbSuccess = ''">✕</button>
        </div>

        <div class="flex min-h-0 flex-1 overflow-hidden">
            <!-- 左侧对话主列 -->
            <div class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                <!-- 消息列表与冷启动卡片 -->
                <div ref="scrollRef" class="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" style="background-color: var(--surface-2)" @scroll="onScroll">
                    <template v-if="chat && chat.messages.length > 0">
                        <ChatMessage
                            v-for="m in chat.messages"
                            :key="m.id"
                            :message="m"
                            @save-knowledge="openSaveKnowledgeModal"
                            @create-schedule="turnMessageIntoSchedule"
                            @inspect-artifact="openArtifactInspector"
                        />
                        <div v-if="chat.status === 'submitted'" class="text-faint flex items-center gap-2 py-2 text-xs" role="status">
                            <span class="inline-block animate-spin" aria-hidden="true">🌀</span>
                            <span>{{ t('chat.thinking') }}</span>
                        </div>

                        <!-- 生成失败：给出可读原因与重试入口 -->
                        <div v-if="chat.error" class="app-alert-danger rounded-2xl border p-4 text-xs" role="alert">
                            <div class="flex items-center justify-between">
                                <span>{{ errorText }}</span>
                                <button class="font-bold underline" @click="handleRegenerate">{{ t('common.retry') }}</button>
                            </div>
                            <p v-if="errorHint" class="text-faint mt-1.5">{{ errorHint }}</p>
                        </div>
                    </template>

                    <ChatEmptyState
                        v-else
                        :agent-id="props.agentId"
                        :agent-emoji="agentEmoji"
                        :agent-name="agentName"
                        :description="headerDescription"
                        :starter-prompts="starterPrompts"
                        :switchable="switchable"
                        @open-agent-picker="openAgentPicker"
                        @send="handleSubmit"
                        @fill="fillPrompt"
                    />
                </div>

                <!-- 回到底部悬浮微按钮 -->
                <div v-if="showScrollBottom" class="absolute right-6 bottom-28 z-20 transition-all duration-200">
                    <button
                        type="button"
                        class="bg-primary-600 hover:bg-primary-700 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-[color:var(--on-brand)] shadow-md transition-transform active:scale-95"
                        @click="scrollToBottom"
                    >
                        <span>↓ {{ t('chat.scrollToBottom') }}</span>
                        <span v-if="hasNewMessage" class="flex h-2 w-2 animate-ping rounded-full bg-[color:var(--warning)]" />
                    </button>
                </div>

                <!-- 发送前本地错误（建会话失败）与会话历史加载失败 -->
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
                    <p v-if="localErrorHint" class="text-faint mt-1.5 text-xs">{{ localErrorHint }}</p>
                </div>

                <!-- 输入栏（多行自适应 + 快捷上下文与技能条） -->
                <form class="p-3.5" style="border-top: 1px solid var(--line); background-color: var(--surface)" @submit.prevent="() => handleSubmit()">
                    <!-- 快捷上下文与技能芯片栏 -->
                    <div class="mb-2 flex flex-wrap items-center gap-1.5">
                        <button type="button" class="app-chip !py-0.5 !text-[10px] hover:opacity-90" :disabled="uploadingInChat" @click="openAttachPicker">
                            <span>@ {{ t('chat.contextAttach') }}</span>
                        </button>
                        <button
                            v-for="sk in agent?.skills ?? []"
                            :key="sk.id"
                            type="button"
                            class="app-chip !py-0.5 !text-[10px] hover:opacity-90"
                            :title="sk.description"
                            @click="insertSkillPrompt(sk.name)"
                        >
                            <span>🧩 /{{ sk.name }}</span>
                        </button>
                    </div>

                    <!-- 工具审批：服务端工具 execute 正在等待这一次决定 -->
                    <ApprovalCard v-if="pendingApproval" :approval="pendingApproval" @decided="onApprovalDecided" />

                    <!-- 待发送附件 -->
                    <div v-if="pendingAttachments.length" class="mb-2 flex flex-wrap gap-2">
                        <span v-for="a in pendingAttachments" :key="a.id" class="app-chip max-w-[14rem] !py-1">
                            <AppIcon :name="a.isImage ? 'file-image-outline' : 'file-outline'" :size="13" />
                            <span class="truncate">{{ a.filename }}</span>
                            <span class="text-faint text-[10px]">{{ formatBytes(a.size) }}</span>
                            <button type="button" class="text-faint text-hover-strong -m-1 p-1.5" :title="t('common.delete')" @click="removePending(a.id)">
                                ✕
                            </button>
                        </span>
                    </div>
                    <div v-if="attachError" class="app-alert app-alert-danger mb-2 !text-[11px]" role="alert">{{ attachError }}</div>

                    <div class="relative flex items-end gap-2.5">
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
                            <textarea
                                ref="inputRef"
                                v-model="input"
                                rows="1"
                                :placeholder="t('chat.inputPlaceholder')"
                                :aria-label="t('chat.inputPlaceholder')"
                                class="app-input max-h-36 min-h-[2.375rem] resize-y !py-2 !pr-8 leading-relaxed"
                                @keydown="onInputKeydown"
                            />
                            <button
                                v-if="input"
                                type="button"
                                class="text-faint text-hover-strong absolute top-2 right-1.5 p-1.5 text-xs"
                                :title="t('chat.clearInput')"
                                @click="input = ''"
                            >
                                ✕
                            </button>
                        </div>
                        <button
                            v-if="chat?.status === 'streaming' || chat?.status === 'submitted'"
                            type="button"
                            class="app-btn app-btn-outline shrink-0"
                            @click="stopGeneration"
                        >
                            {{ t('chat.stop') }}
                        </button>
                        <button v-else type="submit" class="app-btn app-btn-primary shrink-0 !px-6" :disabled="submitting">
                            {{ t('chat.send') }}
                        </button>
                    </div>
                    <div class="text-faint mt-1.5 flex items-center justify-between px-1 text-[11px] select-none">
                        <span>💡 {{ t('chat.shortcutHint') }}</span>
                        <span v-if="input.length > 0">{{ t('chat.charCount', { n: input.length }) }}</span>
                    </div>
                </form>
            </div>

            <!-- 右侧可折叠工作台检视栏（Context & Artifact Inspector） -->
            <aside
                v-if="inspectorOpen"
                class="flex w-80 shrink-0 flex-col border-l xl:w-96"
                style="border-color: var(--line); background-color: var(--surface)"
            >
                <div class="flex items-center justify-between border-b px-3.5 py-2.5" style="border-color: var(--line)">
                    <div class="flex items-center gap-1.5">
                        <button
                            type="button"
                            class="app-chip !text-[11px]"
                            :class="inspectorTab === 'context' ? 'app-chip-brand' : ''"
                            @click="selectInspectorTab('context')"
                        >
                            {{ t('chat.inspectorContext') }}
                        </button>
                        <button
                            type="button"
                            class="app-chip !text-[11px]"
                            :class="inspectorTab === 'artifact' ? 'app-chip-brand' : ''"
                            @click="selectInspectorTab('artifact')"
                        >
                            {{ t('chat.inspectorArtifact') }}
                        </button>
                        <button
                            type="button"
                            class="app-chip !text-[11px]"
                            :class="inspectorTab === 'todo' ? 'app-chip-brand' : ''"
                            @click="selectInspectorTab('todo')"
                        >
                            {{ t('chat.inspectorTodo') }}
                        </button>
                        <button
                            type="button"
                            class="app-chip !text-[11px]"
                            :class="inspectorTab === 'timeline' ? 'app-chip-brand' : ''"
                            @click="selectInspectorTab('timeline')"
                        >
                            {{ t('chat.inspectorTimeline') }}
                        </button>
                    </div>
                    <button type="button" class="text-faint text-hover-strong text-xs" :aria-label="t('common.close')" @click="inspectorOpen = false">✕</button>
                </div>

                <!-- Tab 1: 上下文与挂载能力 -->
                <div v-if="inspectorTab === 'context'" class="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
                    <div class="app-card space-y-2 p-3">
                        <div class="flex items-center justify-between">
                            <p class="text-faint text-[10px] font-bold uppercase">{{ t('chat.contextTitle') }}</p>
                            <span class="app-chip !py-0.5 text-[10px]">
                                {{ contextInfo?.source === 'events' ? t('chat.contextEvents') : t('chat.contextMessages') }}
                            </span>
                        </div>
                        <p class="text-strong font-bold">
                            {{
                                t('chat.contextUsage', {
                                    used: contextInfo?.estimatedTokens ?? 0,
                                    budget: contextInfo?.budget ?? 89600,
                                })
                            }}
                        </p>
                        <div class="h-1.5 overflow-hidden rounded-full" style="background-color: var(--line)">
                            <div
                                class="h-full rounded-full transition-all"
                                :style="{ width: `${contextInfo?.percent ?? 0}%`, backgroundColor: 'var(--brand)' }"
                            />
                        </div>
                        <div class="text-faint flex items-center justify-between text-[10px]">
                            <span>{{ t('chat.contextMessagesCount', { n: contextInfo?.messageCount ?? 0 }) }}</span>
                            <span v-if="contextInfo?.compacted">✅ {{ t('chat.contextCompacted') }}</span>
                        </div>
                        <button
                            type="button"
                            class="app-btn app-btn-outline w-full !py-1.5 !text-[11px]"
                            :disabled="!props.conversationId || compacting || chat?.status === 'streaming' || chat?.status === 'submitted'"
                            @click="compactConversation"
                        >
                            {{ compacting ? t('chat.compacting') : t('chat.compactNow') }}
                        </button>
                        <p v-if="compactNotice" class="text-faint text-[10px] leading-relaxed">{{ compactNotice }}</p>
                    </div>

                    <div class="app-card space-y-1.5 p-3">
                        <p class="text-faint text-[10px] font-bold uppercase">{{ t('chat.inspectorSpace') }}</p>
                        <p class="text-strong font-bold">{{ props.spaceName || t('chat.independentChat') }}</p>
                        <NuxtLink
                            v-if="props.spaceId"
                            :to="`/spaces/${encodeURIComponent(props.spaceId)}`"
                            class="text-hover-brand inline-block text-[11px] font-semibold"
                        >
                            {{ t('chat.inspectorEditSpace') }} →
                        </NuxtLink>
                    </div>

                    <div class="app-card space-y-1.5 p-3">
                        <p class="text-faint text-[10px] font-bold uppercase">{{ t('chat.inspectorAgent') }}</p>
                        <p class="text-strong font-bold">{{ agentEmoji }} {{ agentName }}</p>
                        <p v-if="agent?.model" class="text-faint font-mono text-[11px]">{{ agent.model }} · Temp {{ agent.temperature ?? 0.7 }}</p>
                    </div>

                    <div class="space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-strong font-bold">📚 {{ t('library.knowledge') }} ({{ agent?.knowledgeBases?.length ?? 0 }})</span>
                            <NuxtLink to="/library?tab=knowledge" class="text-hover-brand text-[11px]">{{ t('common.edit') }}</NuxtLink>
                        </div>
                        <div v-if="agent?.knowledgeBases?.length" class="space-y-1.5">
                            <div v-for="kb in agent.knowledgeBases" :key="kb.id" class="app-card p-2.5">
                                <p class="text-strong font-semibold">{{ kb.name }}</p>
                            </div>
                        </div>
                        <p v-else class="text-faint text-[11px]">{{ t('chat.inspectorNoKb') }}</p>
                    </div>

                    <div class="space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-strong font-bold">🧩 Skills ({{ agent?.skills?.length ?? 0 }})</span>
                            <NuxtLink to="/settings/skills" class="text-hover-brand text-[11px]">{{ t('common.edit') }}</NuxtLink>
                        </div>
                        <div v-if="agent?.skills?.length" class="flex flex-wrap gap-1.5">
                            <button v-for="sk in agent.skills" :key="sk.id" type="button" class="app-chip !text-[10px]" @click="insertSkillPrompt(sk.name)">
                                🧩 {{ sk.name }}
                            </button>
                        </div>
                        <p v-else class="text-faint text-[11px]">{{ t('common.none') }}</p>
                    </div>

                    <div class="space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-strong font-bold">🛠️ Tools & MCP ({{ (agent?.tools?.length ?? 0) + (agent?.mcpServers?.length ?? 0) }})</span>
                            <NuxtLink to="/settings/mcp" class="text-hover-brand text-[11px]">{{ t('common.edit') }}</NuxtLink>
                        </div>
                        <div class="flex flex-wrap gap-1.5">
                            <span class="app-chip app-chip-brand !text-[10px]">⚡ {{ t('chat.inspectorBuiltinTools') }}</span>
                            <span v-for="tl in agent?.tools ?? []" :key="tl.id" class="app-chip !text-[10px]">🛠️ {{ tl.name }}</span>
                            <span v-for="ms in agent?.mcpServers ?? []" :key="ms.id" class="app-chip !text-[10px]">🔌 {{ ms.name }}</span>
                        </div>
                    </div>
                </div>

                <!-- Tab 2: 产物阅读与沉淀画布 -->
                <div v-else-if="inspectorTab === 'artifact'" class="flex flex-1 flex-col overflow-hidden">
                    <div v-if="artifacts.length" class="space-y-1.5 border-b px-3.5 py-2.5" style="border-color: var(--line)">
                        <p class="text-faint text-[10px] font-bold uppercase">{{ t('chat.artifactsTitle') }}</p>
                        <a
                            v-for="item in artifacts"
                            :key="item.id"
                            :href="`/api/artifacts/${encodeURIComponent(item.id)}/download`"
                            class="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-[var(--surface-2)]"
                        >
                            <span class="truncate">📎 {{ item.title }}</span>
                            <span class="text-faint shrink-0">{{ Math.max(1, Math.ceil(item.size / 1024)) }} KB</span>
                        </a>
                    </div>
                    <div v-if="artifacts.length" class="px-3.5 pb-2">
                        <button type="button" class="app-btn app-btn-outline !px-2 !py-1 !text-[11px]" @click="loadArtifacts">
                            {{ t('common.retry') }}
                        </button>
                    </div>
                    <div v-if="effectiveArtifactText" class="flex items-center justify-between gap-2 border-b px-3.5 py-2" style="border-color: var(--line)">
                        <div class="flex items-center gap-1.5">
                            <button type="button" class="app-btn app-btn-outline !px-2 !py-1 !text-[11px]" @click="copyArtifactText">
                                {{ artifactCopied ? t('common.copied') : t('common.copy') }}
                            </button>
                            <button type="button" class="app-btn app-btn-outline !px-2 !py-1 !text-[11px]" @click="downloadArtifactMarkdown">📥 .md</button>
                        </div>
                        <button
                            type="button"
                            class="app-btn app-btn-primary !px-2.5 !py-1 !text-[11px]"
                            @click="openSaveKnowledgeModal({ text: effectiveArtifactText })"
                        >
                            📚 {{ t('chat.saveToKnowledge') }}
                        </button>
                    </div>
                    <div v-if="effectiveArtifactText" class="flex-1 overflow-y-auto p-4 text-xs leading-relaxed">
                        <Suspense>
                            <Markdown :value="effectiveArtifactText" class="markdown-body" />
                            <template #fallback>
                                <pre class="whitespace-pre-wrap">{{ effectiveArtifactText }}</pre>
                            </template>
                        </Suspense>
                    </div>
                    <div v-else class="text-faint flex flex-1 items-center justify-center p-6 text-center text-xs">
                        {{ t('chat.inspectorArtifactEmpty') }}
                    </div>
                </div>

                <!-- Tab 4: 事件时间线（消息 / 工具 / 审批 / 压缩 / 运行） -->
                <div v-else-if="inspectorTab === 'timeline'" class="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <SessionTimeline :conversation-id="loadedConversationId" :refresh-key="chat?.status === 'ready' ? chat.messages.length : chat?.status" />
                </div>

                <!-- Tab 3: 会话待办与目标 -->
                <div v-else-if="inspectorTab === 'todo'" class="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
                    <div v-if="todoError" class="app-alert app-alert-danger !text-[11px]">{{ todoError }}</div>

                    <div class="app-card space-y-2 p-3">
                        <div class="flex items-center justify-between">
                            <p class="text-faint text-[10px] font-bold uppercase">{{ t('chat.planModeTitle') }}</p>
                            <input type="checkbox" class="accent-[var(--brand)]" :checked="planMode" :disabled="assistBusy" @change="togglePlanMode" />
                        </div>
                        <p class="text-faint text-[10px] leading-relaxed">{{ t('chat.planModeHint') }}</p>
                        <p v-if="planMode" class="text-[10px] font-semibold" style="color: var(--brand)">
                            {{ t('chat.planModeOn') }}
                        </p>
                    </div>

                    <div class="app-card space-y-2 p-3">
                        <div class="flex items-center justify-between">
                            <p class="text-faint text-[10px] font-bold uppercase">{{ t('chat.todoTitle') }}</p>
                            <span class="app-chip !py-0.5 text-[10px]">{{ todoItems.length }}</span>
                        </div>
                        <ul v-if="todoItems.length" class="space-y-1.5">
                            <li v-for="item in todoItems" :key="item.id" class="flex items-start gap-2">
                                <input
                                    type="checkbox"
                                    class="mt-0.5 accent-[var(--brand)]"
                                    :checked="item.status === 'completed'"
                                    :disabled="assistBusy"
                                    @change="toggleTodo(item)"
                                />
                                <div class="min-w-0 flex-1">
                                    <p class="text-strong leading-snug" :class="item.status === 'completed' ? 'line-through opacity-60' : ''">
                                        {{ item.title }}
                                    </p>
                                    <p v-if="item.status === 'in_progress'" class="text-[10px]" style="color: var(--brand)">
                                        {{ t('chat.todoInProgress') }}
                                    </p>
                                    <p v-if="item.note" class="text-faint text-[10px] leading-snug">{{ item.note }}</p>
                                </div>
                            </li>
                        </ul>
                        <p v-else class="text-faint text-[11px] leading-relaxed">{{ t('chat.todoEmpty') }}</p>
                    </div>

                    <div class="app-card space-y-2 p-3">
                        <div class="flex items-center justify-between">
                            <p class="text-faint text-[10px] font-bold uppercase">{{ t('chat.goalTitle') }}</p>
                            <span v-if="goal" class="app-chip !py-0.5 text-[10px]">{{ t(`chat.goalStatus.${goal.status}`) }}</span>
                        </div>
                        <template v-if="goal">
                            <p class="text-strong leading-relaxed font-bold">{{ goal.objective }}</p>
                            <p class="text-faint text-[10px]">
                                {{ t('chat.goalRound', { round: goal.round, max: goal.maxRounds, revision: goal.revision }) }}
                            </p>
                            <button
                                type="button"
                                class="app-btn app-btn-outline w-full !py-1.5 !text-[11px]"
                                :disabled="assistBusy || goal.status === 'completed' || goal.status === 'blocked' || goal.round >= goal.maxRounds"
                                @click="continueGoal"
                            >
                                {{ t('chat.goalContinue') }}
                            </button>
                        </template>
                        <p v-else class="text-faint text-[11px] leading-relaxed">{{ t('chat.goalEmpty') }}</p>
                    </div>
                </div>
            </aside>
        </div>

        <!-- 一键存入知识库弹层 -->
        <Teleport to="body">
            <div
                v-if="saveKbOpen"
                class="app-modal-backdrop"
                role="dialog"
                aria-modal="true"
                :aria-label="t('chat.saveToKnowledge')"
                @click.self="saveKbOpen = false"
            >
                <form class="app-card w-full max-w-lg space-y-4 p-5" @submit.prevent="submitSaveKnowledge">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-black">📚 {{ t('chat.saveToKnowledge') }}</h3>
                        <button type="button" class="text-faint text-hover-strong" :aria-label="t('common.close')" @click="saveKbOpen = false">✕</button>
                    </div>
                    <div v-if="saveKbError" class="app-alert app-alert-danger !text-xs">{{ saveKbError }}</div>
                    <div>
                        <label class="app-label">{{ t('library.ingestTargetKb') }}</label>
                        <select v-if="saveKbOptions.length" v-model="saveKbTargetId" class="app-input !text-xs">
                            <option v-for="kb in saveKbOptions" :key="kb.id" :value="kb.id">{{ kb.name }}</option>
                        </select>
                        <p v-else class="text-faint text-xs">{{ t('chat.saveToKnowledgeAutoCreate') }}</p>
                    </div>
                    <div>
                        <label class="app-label">{{ t('library.ingestDocTitle') }}</label>
                        <input v-model="saveKbTitle" required maxlength="200" class="app-input !text-xs" />
                    </div>
                    <div>
                        <label class="app-label">{{ t('knowledge.docContent') }}</label>
                        <textarea v-model="saveKbContent" rows="6" required class="app-input font-mono !text-xs" />
                    </div>
                    <div class="flex justify-end gap-2">
                        <button type="button" class="app-btn app-btn-outline" @click="saveKbOpen = false">{{ t('common.cancel') }}</button>
                        <button type="submit" :disabled="saveKbBusy" class="app-btn app-btn-primary">
                            {{ saveKbBusy ? t('common.saving') : t('common.save') }}
                        </button>
                    </div>
                </form>
            </div>
        </Teleport>

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
