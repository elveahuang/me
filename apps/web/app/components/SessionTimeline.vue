<script setup lang="ts">
import { formatBytes, formatDateTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { extractFileDiff, type TimelineFileDiff } from '../utils/timeline';

/**
 * 会话时间线（P1-6 / P3-2）：把 `session_events` 这条 append-only 日志按 seq 展开，
 * 不再只以「消息气泡」为唯一叙事。工具调用把配对的结果合并成一张卡（状态、耗时、输出大小），
 * 审批、压缩、run 起止都按真实顺序穿插；没有 run/end 的轮次明确标成「未收尾」。
 *
 * 事件日志本身是旁路，这里加载失败只影响时间线，不能影响聊天主体。
 */

interface SessionEvent {
    seq: number;
    type: string;
    turnId: string | null;
    stepId: string | null;
    surfaceOp: string | null;
    data: Record<string, unknown>;
    createdAt: string;
}

interface TimelineItem {
    seq: number;
    type: string;
    label: string;
    detail: string;
    tone: 'normal' | 'ok' | 'warn' | 'danger' | 'muted';
    at: string;
    diff?: TimelineFileDiff;
}

const props = defineProps<{
    conversationId: string | null;
    /** 聊天状态或消息数变化时重新拉取：自动压缩、工具收尾都会在这里体现 */
    refreshKey?: string | number | null;
}>();

const { t } = useI18n();

const events = ref<SessionEvent[]>([]);
const loading = ref(false);
const loadingOlder = ref(false);
const hasOlder = ref(false);
const error = ref('');
const listEl = ref<HTMLElement | null>(null);
let loadToken = 0;
let loadedId: string | null = null;

const PAGE_SIZE = 100;

interface EventsPage {
    events: SessionEvent[];
    nextAfter: number;
    nextBefore: number;
    hasMore: boolean;
}

const TOOL_RESULT_MAX_BYTES = 20 * 1024;

function textOf(value: unknown, max = 160): string {
    if (typeof value !== 'string') return '';
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

function partsText(parts: unknown): string {
    if (!Array.isArray(parts)) return '';
    const texts = parts
        .map((part) => (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' ? (part as { text?: unknown }).text : null))
        .filter((text): text is string => typeof text === 'string');
    return textOf(texts.join(' '));
}

/** 首屏只取最近一页：时间线是观测面板，先看最新一轮，旧事件按需「加载更早」。 */
async function load() {
    const id = props.conversationId;
    if (!id) {
        events.value = [];
        hasOlder.value = false;
        loadedId = null;
        return;
    }
    const token = ++loadToken;
    loading.value = true;
    error.value = '';
    try {
        const result = await $fetch<EventsPage>(`/api/sessions/${encodeURIComponent(id)}/events`, {
            query: { limit: PAGE_SIZE },
        });
        if (token !== loadToken) return;
        events.value = result.events;
        hasOlder.value = result.hasMore;
        loadedId = id;
    } catch (e) {
        if (token !== loadToken) return;
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        if (token === loadToken) loading.value = false;
    }
}

/** 反向取更早一页并前插；保持滚动位置，避免用户正在看的那一条被顶走。 */
async function loadOlder() {
    const id = props.conversationId;
    const oldest = events.value[0]?.seq;
    if (!id || !oldest || loadingOlder.value) return;
    const token = loadToken;
    const el = listEl.value;
    const previousHeight = el?.scrollHeight ?? 0;
    loadingOlder.value = true;
    error.value = '';
    try {
        const result = await $fetch<EventsPage>(`/api/sessions/${encodeURIComponent(id)}/events`, {
            query: { before: oldest, limit: PAGE_SIZE },
        });
        if (token !== loadToken) return;
        events.value = [...result.events, ...events.value];
        hasOlder.value = result.hasMore;
        await nextTick();
        if (el && previousHeight) el.scrollTop += el.scrollHeight - previousHeight;
    } catch (e) {
        if (token !== loadToken) return;
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        if (token === loadToken) loadingOlder.value = false;
    }
}

const items = computed<TimelineItem[]>(() => {
    const results = new Map<string, SessionEvent>();
    const endedTurns = new Set<string>();
    for (const event of events.value) {
        if (event.type === 'tool/result') {
            const callId = typeof event.data.toolCallId === 'string' ? event.data.toolCallId : '';
            if (callId) results.set(callId, event);
        }
        if (event.type === 'run/end' && event.turnId) endedTurns.add(event.turnId);
    }

    const knownCalls = new Set<string>();
    const out: TimelineItem[] = [];
    for (const event of events.value) {
        const at = event.createdAt;
        const data = event.data;
        if (event.type === 'tool/result') {
            const callId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
            // 正常结果已经在 tool/call 卡片里合并；孤立结果（调用事件缺失）仍要显示，不能静默吞掉。
            if (callId && knownCalls.has(callId)) continue;
            out.push({
                seq: event.seq,
                type: event.type,
                label: t('chat.timelineToolResultOrphan'),
                detail: t('chat.timelineTool', { name: typeof data.toolName === 'string' ? data.toolName : '?' }),
                tone: 'warn',
                at,
            });
            continue;
        }
        if (event.type === 'tool/call') {
            const callId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
            if (callId) knownCalls.add(callId);
            const result = callId ? results.get(callId) : undefined;
            const name = typeof data.toolName === 'string' ? data.toolName : '?';
            const resultData = result?.data ?? {};
            const failed = Boolean(resultData.error) || resultData.ok === false;
            const open = !result && !(event.turnId && endedTurns.has(event.turnId));
            const duration = result ? Math.max(0, new Date(result.createdAt).getTime() - new Date(at).getTime()) : 0;
            const output = result ? JSON.stringify(resultData.output ?? resultData.error ?? resultData) : '';
            const size = new TextEncoder().encode(output).length;
            out.push({
                seq: event.seq,
                type: event.type,
                label: t('chat.timelineTool', { name }),
                detail: result
                    ? `${failed ? t('chat.timelineToolFailed') : t('chat.timelineToolDone')} · ${t('chat.timelineDuration', { ms: duration })} · ${t('chat.timelineOutput', { size: formatBytes(Math.min(size, TOOL_RESULT_MAX_BYTES)) })}`
                    : open
                      ? t('chat.timelineToolRunning')
                      : t('chat.timelineToolUnknown'),
                tone: result ? (failed ? 'danger' : 'ok') : open ? 'warn' : 'muted',
                at,
                diff: extractFileDiff(name, data.input) ?? undefined,
            });
            continue;
        }
        if (event.type === 'user/message') {
            out.push({
                seq: event.seq,
                type: event.type,
                label: t('chat.timelineUser'),
                detail: partsText(data.parts),
                tone: 'normal',
                at,
            });
            continue;
        }
        if (event.type === 'assistant/message') {
            const checkpoint = data.checkpoint === true;
            out.push({
                seq: event.seq,
                type: event.type,
                label: checkpoint ? t('chat.timelineCheckpoint', { step: data.stepNumber ?? '?' }) : t('chat.timelineAssistant'),
                detail: checkpoint ? '' : partsText(data.parts),
                tone: 'normal',
                at,
            });
            continue;
        }
        if (event.type === 'system/message') {
            out.push({ seq: event.seq, type: event.type, label: t('chat.timelineSystem'), detail: textOf(data.text), tone: 'muted', at });
            continue;
        }
        if (event.type === 'run/start') {
            const open = Boolean(event.turnId && !endedTurns.has(event.turnId));
            out.push({
                seq: event.seq,
                type: event.type,
                label: t('chat.timelineRunStart'),
                detail: open ? t('chat.timelineRunOpen') : '',
                tone: open ? 'warn' : 'muted',
                at,
            });
            continue;
        }
        if (event.type === 'run/end') {
            const status = typeof data.status === 'string' ? data.status : '?';
            out.push({
                seq: event.seq,
                type: event.type,
                label: t('chat.timelineRunEnd', { status }),
                detail: typeof data.reason === 'string' ? textOf(data.reason) : '',
                tone: status === 'completed' ? 'ok' : status === 'aborted' || status === 'interrupted' ? 'warn' : 'danger',
                at,
            });
            continue;
        }
        if (event.type === 'request/header') {
            out.push({
                seq: event.seq,
                type: event.type,
                label: t('chat.timelineRequest'),
                detail: [
                    typeof data.model === 'string' ? data.model : '',
                    typeof data.estimatedContextTokens === 'number' ? t('chat.timelineTokens', { n: data.estimatedContextTokens }) : '',
                    typeof data.contextSource === 'string' ? data.contextSource : '',
                ]
                    .filter(Boolean)
                    .join(' · '),
                tone: 'muted',
                at,
            });
            continue;
        }
        if (event.type.startsWith('compaction/')) {
            out.push({
                seq: event.seq,
                type: event.type,
                label:
                    event.type === 'compaction/start'
                        ? t('chat.timelineCompactionStart')
                        : event.type === 'compaction/end'
                          ? t('chat.timelineCompactionEnd')
                          : t('chat.timelineCompaction'),
                detail:
                    event.type === 'compaction/end' && typeof data.tokensBefore === 'number' && typeof data.tokensAfter === 'number'
                        ? t('chat.timelineCompactionSize', { before: data.tokensBefore, after: data.tokensAfter })
                        : '',
                tone: 'warn',
                at,
            });
            continue;
        }
        if (event.type === 'approval/asked') {
            out.push({
                seq: event.seq,
                type: event.type,
                label: t('chat.timelineApprovalAsked'),
                detail: typeof data.toolName === 'string' ? t('chat.timelineTool', { name: data.toolName }) : '',
                tone: 'warn',
                at,
            });
            continue;
        }
        if (event.type === 'approval/decided') {
            const decision = typeof data.decision === 'string' ? data.decision : '?';
            out.push({
                seq: event.seq,
                type: event.type,
                label: t('chat.timelineApprovalDecided', { decision }),
                detail: typeof data.reason === 'string' ? textOf(data.reason) : '',
                tone: decision === 'allow' ? 'ok' : 'danger',
                at,
            });
            continue;
        }
        if (event.type === 'todo/updated' || event.type === 'goal/updated' || event.type.startsWith('plan/')) {
            out.push({
                seq: event.seq,
                type: event.type,
                label: t(`chat.timelineEvent.${event.type.replace('/', '_')}`),
                detail: '',
                tone: 'muted',
                at,
            });
            continue;
        }
        out.push({ seq: event.seq, type: event.type, label: event.type, detail: '', tone: 'muted', at });
    }
    return out;
});

watch(
    () => [props.conversationId, props.refreshKey] as const,
    () => {
        if (props.conversationId !== loadedId) {
            events.value = [];
        }
        void load();
    },
    { immediate: true },
);
</script>

<template>
    <div class="flex h-full flex-col overflow-hidden">
        <div class="flex items-center justify-between border-b px-3.5 py-2" style="border-color: var(--line)">
            <p class="text-faint text-[10px] font-bold uppercase">{{ t('chat.timelineTitle') }}</p>
            <button type="button" class="app-btn app-btn-outline !px-2 !py-1 !text-[10px]" :disabled="loading" @click="load">
                {{ loading ? t('chat.timelineLoading') : t('chat.timelineRefresh') }}
            </button>
        </div>

        <div ref="listEl" class="flex-1 space-y-2 overflow-y-auto p-3 text-xs">
            <div v-if="error" class="app-alert app-alert-danger !text-[11px]">
                <div class="flex items-center justify-between gap-2">
                    <span>{{ t('chat.timelineLoadFailed') }}</span>
                    <button type="button" class="font-bold underline" @click="load">{{ t('common.retry') }}</button>
                </div>
                <p class="text-[10px] opacity-80">{{ error }}</p>
            </div>
            <p v-if="!conversationId" class="text-faint text-[11px]">{{ t('chat.timelineEmpty') }}</p>
            <p v-else-if="!events.length && !loading && !error" class="text-faint text-[11px]">{{ t('chat.timelineEmpty') }}</p>

            <div v-if="hasOlder" class="flex justify-center">
                <button type="button" class="app-btn app-btn-outline !px-2 !py-1 !text-[10px]" :disabled="loadingOlder" @click="loadOlder">
                    {{ loadingOlder ? t('chat.timelineLoadingOlder') : t('chat.timelineLoadOlder') }}
                </button>
            </div>

            <ol v-if="events.length" class="space-y-2">
                <li
                    v-for="item in items"
                    :key="`${item.seq}:${item.type}`"
                    class="app-card !p-2.5"
                    :style="{
                        borderColor:
                            item.tone === 'danger'
                                ? 'var(--danger)'
                                : item.tone === 'warn'
                                  ? 'var(--warning, var(--line))'
                                  : item.tone === 'ok'
                                    ? 'var(--ok, var(--line))'
                                    : 'var(--line)',
                    }"
                >
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-strong text-[11px] font-bold">{{ item.label }}</span>
                        <span class="text-faint shrink-0 text-[10px]">#{{ item.seq }}</span>
                    </div>
                    <p v-if="item.detail" class="text-faint mt-1 text-[10px] leading-relaxed break-words">{{ item.detail }}</p>
                    <div v-if="item.diff" class="mt-1.5 space-y-1">
                        <pre
                            class="max-h-40 overflow-auto rounded-md px-2 py-1.5 text-[10px] leading-relaxed break-words whitespace-pre-wrap"
                            style="background: color-mix(in srgb, var(--danger) 10%, transparent)"
                        >
- {{ item.diff.oldText }}</pre>
                        <pre
                            class="max-h-40 overflow-auto rounded-md px-2 py-1.5 text-[10px] leading-relaxed break-words whitespace-pre-wrap"
                            style="background: color-mix(in srgb, var(--ok, #16a34a) 12%, transparent)"
                        >
+ {{ item.diff.newText }}</pre>
                        <p v-if="item.diff.truncated" class="text-faint text-[10px]">{{ t('chat.timelineDiffTruncated') }}</p>
                    </div>
                    <p class="text-faint mt-1 text-[10px]">{{ formatDateTime(item.at) }}</p>
                </li>
            </ol>
        </div>
    </div>
</template>
