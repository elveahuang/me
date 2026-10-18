<script setup lang="ts">
import { extractApiError, formatDateTime, formatTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import {
    INTERVAL_MINUTES_MAX,
    INTERVAL_MINUTES_MIN,
    SCHEDULE_PROMPT_MAX,
    SCHEDULE_KIND_OPTIONS,
    makeWeekdayName,
    relativeDayLabel,
    scheduleStatusTone,
    scheduleSummary,
    type ScheduleKind,
    type WorkSchedule,
    type WorkSpace,
} from '../utils/work';
import { composeStartsAt, dayInputValue, timeTextInputValue, todayInputValue } from '../utils/work-day';

interface RunRow {
    id: string;
    scheduleId: string;
    scheduleTitle: string;
    spaceName: string | null;
    agentId: string;
    agentName: string | null;
    agentEmoji: string | null;
    status: 'running' | 'success' | 'failed';
    trigger: string;
    scheduledFor: string | null;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    prompt: string;
    outputConversationId: string | null;
    error: string;
}
interface RunsResponse {
    runs: RunRow[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}

/**
 * 自动化与运行中心（`/tasks`）：到点自动跑一轮智能体、结果落成一条会话的排期，以及每一次执行的历史记录。
 *
 * 状态全部写进 URL（`?tab=&q=&enabled=&id=&new=1`）：列表每一行点开表单都会把 `?id=` 带回地址，
 * 书签也要能回到同一个筛选结果，把条件只存在 ref 里就等于让深链失效。
 *
 * 列表里的 `prompt` 是服务端截到 240 字的摘要，所以点「编辑」要再取一次整行——
 * 拿摘要回填表单会把用户写的正文当场砍断，保存之后就真没了。
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

const activeTab = ref<'schedules' | 'runs'>(route.query.tab === 'runs' ? 'runs' : 'schedules');
watch(
    () => route.query.tab,
    (tab) => {
        activeTab.value = tab === 'runs' ? 'runs' : 'schedules';
    },
);
function switchTab(tab: 'schedules' | 'runs') {
    activeTab.value = tab;
    const query = { ...route.query };
    if (tab === 'runs') query.tab = 'runs';
    else delete query.tab;
    void router.replace({ query });
}

/**
 * 北京「今天」。
 *
 * 工作台是常驻的桌面应用，页面可能跨过午夜一直开着：写成 setup 时的常量会让「明天」的默认开始日
 * 停在昨天（`once` 排到过去的时刻会被服务端 400 拒绝），列表里的「今天/明天」标签也会整体错一天。
 * 每分钟对一次日期即可，不必更密。
 */
const today = ref(todayInputValue());
let todayTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
    todayTimer = setInterval(() => {
        today.value = todayInputValue();
    }, 60_000);
});
onBeforeUnmount(() => {
    if (todayTimer) clearInterval(todayTimer);
});
const weekdayName = makeWeekdayName(String(locale.value));

const readQuery = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '');
const keywordInput = ref(readQuery('q'));
const keyword = ref(keywordInput.value);
const enabledFilter = ref(readQuery('enabled'));

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(keywordInput, (value) => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => (keyword.value = value.trim()), 300);
});
onBeforeUnmount(() => {
    if (searchTimer) clearTimeout(searchTimer);
});

watch([enabledFilter, keyword], () => {
    router.replace({ query: { ...route.query, enabled: enabledFilter.value || undefined, q: keyword.value || undefined } });
});

const listQuery = computed(() => ({
    enabled: enabledFilter.value || undefined,
    keyword: keyword.value || undefined,
    limit: '200',
}));
const { data: schedules, pending, error, refresh } = await useFetch<WorkSchedule[]>('/api/schedules', { query: listQuery, lazy: true, default: () => [] });

/* ---------------- 运行记录视图状态 ---------------- */
const runStatus = ref(typeof route.query.status === 'string' ? route.query.status : '');
const runPage = ref(1);
watch(runStatus, () => {
    runPage.value = 1;
});
const runsQuery = computed(() => ({ status: runStatus.value || undefined, page: runPage.value, pageSize: 30 }));
const {
    data: runsData,
    pending: runsPending,
    error: runsError,
    refresh: refreshRuns,
} = await useFetch<RunsResponse>('/api/runs', {
    query: runsQuery,
    lazy: true,
    default: () => ({ runs: [], page: 1, pageSize: 30, total: 0, totalPages: 1 }),
});
const runRows = computed(() => runsData.value?.runs ?? []);
const runsLoadFailed = computed(() => Boolean(runsError.value));
const runFilters = computed(() => [
    { value: '', label: t('runs.all') },
    { value: 'running', label: t('runs.running') },
    { value: 'success', label: t('runs.success') },
    { value: 'failed', label: t('runs.failed') },
]);

function runStatusLabel(value: string) {
    return value === 'success' ? t('runs.success') : value === 'failed' ? t('runs.failed') : t('runs.running');
}
function runStatusClass(value: string) {
    return value === 'success' ? 'app-badge-success' : value === 'failed' ? 'app-badge-danger' : 'app-badge-info';
}
function runTriggerLabel(value: string) {
    return value === 'manual' ? t('runs.triggerManual') : value === 'retry' ? t('runs.triggerRetry') : t('runs.triggerSchedule');
}
function runDurationLabel(ms: number | null) {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

const loadFailed = computed(() => !!error.value);
const actionError = ref('');
const { success, flashSuccess } = useFlashSuccess();

/** 手动运行的在途标记：接口立刻返回，但刷新列表前那一行还写着旧状态，先按「正在跑」压住按钮 */
const running = ref<Set<string>>(new Set());
/**
 * 启停在途标记。
 *
 * PATCH 发的是绝对值（`enabled: !row.enabled`），而 `row` 要等 `refresh()` 回来才会变：
 * 连点两下时第二次读到的仍是旧值，两次请求发的是同一个值，用户看到的「开了又关」实际只改了一次。
 * 在途期间直接吞掉重复点击（与 `runNow` 同一口径），服务端语义与界面就不会分叉。
 */
const toggling = ref<Set<string>>(new Set());

const agents = computed(() => agentList.value ?? []);
const { data: agentList } = useFetch<{ id: string; name: string; emoji: string }[]>('/api/agents', { lazy: true, default: () => [] });
const { data: spaceList } = useFetch<WorkSpace[]>('/api/spaces', { lazy: true, default: () => [] });
const spaces = computed(() => spaceList.value ?? []);

/* ---------------- 表单 ---------------- */

const drawerOpen = ref(false);
const editingId = ref<string | null>(null);
/** 表单加载的代人牌：只让最后一次「点行」写入表单（详见 openEdit） */
let editToken = 0;
const saving = ref(false);
const formError = ref('');

const form = reactive({
    title: '',
    prompt: '',
    agentId: '',
    spaceId: '',
    kind: 'daily' as ScheduleKind,
    time: '09:00',
    intervalMinutes: 60,
    days: [] as number[],
    startDay: today.value,
    enabled: true,
});

/**
 * `?new=1` 深链时 onMounted 早于 /api/agents 返回（两个请求都在页面上并行走），resetForm 那一刻
 * agents 还是空数组，于是表单的智能体选择停在「什么都没有」——用户填完标题正文点保存才发现必填。
 * 列表到达后补默认值；编辑表单已经带着 agentId 时不动。
 */
watch(agents, (list) => {
    if (!form.agentId && list.length) form.agentId = list[0]!.id;
});

function resetForm() {
    form.title = '';
    form.prompt = '';
    form.agentId = agents.value[0]?.id ?? '';
    form.spaceId = '';
    form.kind = 'daily';
    form.time = '09:00';
    form.intervalMinutes = 60;
    form.days = [];
    form.startDay = today.value;
    form.enabled = true;
    formError.value = '';
}

function openNew(prefill?: { title?: string; prompt?: string; agentId?: string; spaceId?: string }) {
    // 让在途的 openEdit 作废：否则它的响应回来时会把抽屉重新打开，并盖上「新建」的空表单
    editToken += 1;
    saving.value = false;
    editingId.value = null;
    void router.replace({ query: { ...route.query, id: undefined } });
    resetForm();
    if (prefill?.title) form.title = prefill.title.slice(0, 200);
    if (prefill?.prompt) form.prompt = prefill.prompt.slice(0, SCHEDULE_PROMPT_MAX);
    if (prefill?.agentId) form.agentId = prefill.agentId;
    if (prefill?.spaceId) form.spaceId = prefill.spaceId;
    drawerOpen.value = true;
}

/**
 * 打开某条的表单：参数是 id，不是列表里那一行。
 */
async function openEdit(id: string) {
    const token = ++editToken;
    saving.value = false;
    try {
        const full = await $fetch<WorkSchedule>(`/api/schedules/${encodeURIComponent(id)}`);
        if (token !== editToken) return;
        editingId.value = full.id;
        form.title = full.title;
        form.prompt = full.prompt;
        form.agentId = full.agentId;
        form.spaceId = full.spaceId ?? '';
        form.kind = full.kind;
        form.time = timeTextInputValue(full.timeText) || '09:00';
        form.intervalMinutes = full.intervalMinutes ?? 60;
        form.days = [...(full.days ?? [])];
        form.startDay = dayInputValue(full.startsAt) || today.value;
        form.enabled = full.enabled;
        formError.value = '';
        drawerOpen.value = true;
        void router.replace({ query: { ...route.query, id: full.id } });
    } catch (e) {
        if (token !== editToken) return;
        actionError.value = extractApiError(e, t('work.scheduleLoadFailed'));
    }
}

/** 表单关掉，`?id=` 就跟着走——留在地址里等于「刷新后再一次打开这条的表单」，而用户已经关掉了。 */
watch(drawerOpen, (open) => {
    if (!open && route.query.id) void router.replace({ query: { ...route.query, id: undefined } });
});

/** `once` 的钟点也来自 `startDay + time`，其余类型的 `time` 就是重复的钟点；两种都要填 */
const showClock = computed(() => form.kind !== 'interval');
const showDays = computed(() => form.kind === 'weekly');
const showInterval = computed(() => form.kind === 'interval');

function toggleDay(index: number) {
    form.days = form.days.includes(index) ? form.days.filter((d) => d !== index) : [...form.days, index].sort((a, b) => a - b);
}

async function save() {
    const title = form.title.trim();
    const prompt = form.prompt.trim();
    if (!title) return (formError.value = t('common.required', { field: t('work.fieldTitle') }));
    if (!prompt) return (formError.value = t('common.required', { field: t('work.fieldPrompt') }));
    if (!form.agentId) return (formError.value = t('common.required', { field: t('work.fieldAgent') }));
    if (!agents.value.length) return (formError.value = t('work.noAgentToPick'));
    const startsAt = composeStartsAt(form.startDay, showClock.value ? form.time : '');
    if (!startsAt) return (formError.value = t('common.required', { field: t('work.fieldStartDay') }));
    if (form.kind === 'once' && new Date(startsAt).getTime() <= Date.now()) return (formError.value = t('work.onceAlreadyPassed'));

    saving.value = true;
    formError.value = '';
    const token = editToken;
    const wasEditing = Boolean(editingId.value);
    const body = {
        title,
        prompt,
        agentId: form.agentId,
        spaceId: form.spaceId || null,
        kind: form.kind,
        time: showClock.value ? form.time : '',
        intervalMinutes: showInterval.value ? form.intervalMinutes : undefined,
        days: showDays.value ? form.days : [],
        startsAt,
        enabled: form.enabled,
    };
    try {
        if (editingId.value) await $fetch(`/api/schedules/${encodeURIComponent(editingId.value)}`, { method: 'PATCH', body });
        else await $fetch('/api/schedules', { method: 'POST', body });
        if (token === editToken) drawerOpen.value = false;
        flashSuccess(wasEditing ? t('common.saved') : t('work.scheduleAdded'));
        await refresh();
    } catch (e) {
        const failure = extractApiError(e, t('common.error'));
        if (token === editToken) formError.value = failure;
        else actionError.value = failure;
    } finally {
        if (token === editToken) saving.value = false;
    }
}

async function toggleEnabled(row: WorkSchedule) {
    if (toggling.value.has(row.id)) return;
    toggling.value = new Set(toggling.value).add(row.id);
    try {
        await $fetch(`/api/schedules/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { enabled: !row.enabled } });
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    } finally {
        const next = new Set(toggling.value);
        next.delete(row.id);
        toggling.value = next;
    }
}

async function runNow(row: WorkSchedule) {
    if (running.value.has(row.id)) return;
    running.value = new Set(running.value).add(row.id);
    try {
        await $fetch(`/api/schedules/${encodeURIComponent(row.id)}/run`, { method: 'POST' });
        flashSuccess(t('work.scheduleRunQueued'));
        await Promise.all([refresh(), refreshRuns()]);
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    } finally {
        const next = new Set(running.value);
        next.delete(row.id);
        running.value = next;
    }
}

async function remove(id: string, title: string) {
    if (!confirm(t('work.deleteScheduleConfirm', { title }))) return;
    try {
        await $fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
        drawerOpen.value = false;
        flashSuccess(t('common.deleted'));
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}

function removeCurrent() {
    const id = editingId.value;
    if (!id) return;
    void remove(id, form.title.trim() || t('work.scheduleTitlePlaceholder'));
}

onMounted(() => {
    const id = readQuery('id');
    if (id) {
        void router.replace({ query: { ...route.query, id: undefined } });
        void openEdit(id);
        return;
    }
    if (route.query.new !== '1') return;
    const prefill = {
        title: readQuery('title'),
        prompt: readQuery('prompt'),
        agentId: readQuery('agentId'),
        spaceId: readQuery('spaceId'),
    };
    const nextQuery = { ...route.query };
    delete nextQuery.new;
    delete nextQuery.title;
    delete nextQuery.prompt;
    delete nextQuery.agentId;
    delete nextQuery.spaceId;
    void router.replace({ query: nextQuery });
    openNew(prefill);
});
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ activeTab === 'runs' ? t('runs.title') : t('work.schedulesTitle') }}</h1>
                <p class="app-page-subtitle">
                    {{ activeTab === 'runs' ? t('runs.subtitle') : t('work.schedulesSubtitle', { n: (schedules ?? []).length }) }}
                </p>
            </div>
            <div class="app-page-actions">
                <button v-if="activeTab === 'runs'" type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs" @click="refreshRuns()">
                    {{ t('common.retry') }}
                </button>
                <button type="button" class="app-btn app-btn-primary" @click="openNew()">
                    <AppIcon name="plus" :size="16" />
                    <span>{{ t('work.newSchedule') }}</span>
                </button>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 border-b border-[color:var(--line)] pb-3">
            <button
                type="button"
                class="app-chip"
                :class="activeTab === 'schedules' ? 'app-chip-brand' : ''"
                :aria-pressed="activeTab === 'schedules'"
                @click="switchTab('schedules')"
            >
                <AppIcon name="timer-outline" :size="14" class="mr-1" />
                <span>{{ t('work.schedulesTitle') }}</span>
                <span class="ml-1 opacity-70">{{ (schedules ?? []).length }}</span>
            </button>
            <button
                type="button"
                class="app-chip"
                :class="activeTab === 'runs' ? 'app-chip-brand' : ''"
                :aria-pressed="activeTab === 'runs'"
                @click="switchTab('runs')"
            >
                <AppIcon name="history" :size="14" class="mr-1" />
                <span>{{ t('runs.title') }}</span>
                <span class="ml-1 opacity-70">{{ runsData?.total ?? 0 }}</span>
            </button>
        </div>

        <template v-if="activeTab === 'schedules'">
            <div class="flex flex-wrap items-center gap-2">
                <div class="relative min-w-0 flex-1 sm:max-w-xs">
                    <AppIcon name="magnify" :size="15" class="text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                    <input
                        v-model="keywordInput"
                        class="app-input !pl-8 !text-xs"
                        :placeholder="t('work.searchSchedules')"
                        :aria-label="t('work.searchSchedules')"
                    />
                </div>
                <button
                    v-for="chip in [
                        { value: '', label: t('common.all') },
                        { value: '1', label: t('common.enabled') },
                        { value: '0', label: t('common.disabled') },
                    ]"
                    :key="chip.value || 'all'"
                    type="button"
                    class="app-chip"
                    :class="enabledFilter === chip.value ? 'app-chip-brand' : ''"
                    :aria-pressed="enabledFilter === chip.value"
                    @click="enabledFilter = chip.value"
                >
                    {{ chip.label }}
                </button>
            </div>

            <div v-if="loadFailed" class="app-alert app-alert-danger flex items-center gap-2">
                <AppIcon name="alert-outline" :size="16" />
                <span class="min-w-0 flex-1">{{ extractApiError(error, t('common.loadFailed')) }}</span>
                <button type="button" class="app-btn app-btn-soft !px-3 !py-1 !text-[10px]" @click="refresh()">{{ t('common.retry') }}</button>
            </div>
            <div v-if="actionError" class="app-alert app-alert-danger flex items-center gap-2">
                <AppIcon name="alert-outline" :size="16" />
                <span class="min-w-0 flex-1">{{ actionError }}</span>
                <button type="button" class="app-btn app-btn-ghost app-btn-icon !h-6 !w-6" :aria-label="t('common.close')" @click="actionError = ''">
                    <AppIcon name="close" :size="13" />
                </button>
            </div>
            <div v-if="success" class="app-alert app-alert-success">
                <AppIcon name="check-circle-outline" :size="16" />
                <span>{{ success }}</span>
            </div>

            <div v-if="pending && !(schedules ?? []).length" class="space-y-2">
                <div v-for="i in 4" :key="i" class="app-skeleton h-20" />
            </div>

            <ul v-else-if="(schedules ?? []).length" class="space-y-2">
                <li v-for="row in schedules ?? []" :key="row.id" class="app-card flex flex-col gap-2 p-4">
                    <div class="flex items-start gap-2">
                        <button
                            type="button"
                            role="switch"
                            class="app-switch mt-0.5 shrink-0"
                            :aria-checked="row.enabled"
                            :aria-label="t('adminForm.enable')"
                            :aria-busy="toggling.has(row.id)"
                            :disabled="toggling.has(row.id)"
                            :title="row.enabled ? t('common.enabled') : t('common.disabled')"
                            @click="toggleEnabled(row)"
                        />
                        <div class="min-w-0 flex-1">
                            <button type="button" class="block w-full truncate text-left text-sm font-bold" :title="row.title" @click="openEdit(row.id)">
                                {{ row.title }}
                            </button>
                            <p class="text-faint mt-1 line-clamp-2 text-[11px]">{{ row.prompt }}</p>
                        </div>
                        <div class="app-hover-reveal flex shrink-0 items-center gap-1">
                            <button
                                type="button"
                                class="app-btn app-btn-ghost app-btn-icon app-btn-sm"
                                :disabled="running.has(row.id) || row.lastStatus === 'running'"
                                :aria-label="t('work.runNow')"
                                :title="t('work.runNow')"
                                @click="runNow(row)"
                            >
                                <AppIcon name="play-circle-outline" :size="14" />
                            </button>
                            <button
                                type="button"
                                class="app-btn app-btn-ghost app-btn-icon app-btn-sm"
                                :aria-label="t('common.edit')"
                                @click="openEdit(row.id)"
                            >
                                <AppIcon name="pencil-outline" :size="14" />
                            </button>
                            <button
                                type="button"
                                class="app-btn app-btn-ghost app-btn-icon app-btn-sm"
                                :aria-label="t('common.delete')"
                                @click="remove(row.id, row.title)"
                            >
                                <AppIcon name="trash-can-outline" :size="14" />
                            </button>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
                        <span class="text-brand flex items-center gap-1 font-medium">
                            <AppIcon name="timer-outline" :size="12" />
                            {{ scheduleSummary(row, t, weekdayName) }}
                        </span>
                        <span class="text-faint flex items-center gap-1">
                            <span class="text-lg leading-none">{{ row.agentEmoji }}</span>
                            {{ row.agentName }}
                        </span>
                        <span class="app-chip shrink-0 !px-1.5 !py-0 !text-[9px]" :class="row.spaceName ? 'app-chip-brand' : ''">
                            {{ row.spaceName || t('work.globalSpace') }}
                        </span>
                        <span class="text-faint flex items-center gap-1">
                            {{ t('work.nextRun') }}
                            <b class="text-strong font-medium">{{
                                row.enabled ? `${relativeDayLabel(row.nextRunAt, today, t, formatDateTime)} ${formatTime(row.nextRunAt)}` : t('work.paused')
                            }}</b>
                        </span>
                        <span v-if="row.lastStatus" class="app-badge" :class="scheduleStatusTone(row.lastStatus)">
                            {{
                                row.lastStatus === 'running'
                                    ? t('work.statusRunning')
                                    : row.lastStatus === 'success'
                                      ? t('work.statusSuccess')
                                      : t('work.statusFailed')
                            }}
                        </span>
                        <span v-if="row.lastRunAt" class="text-faint">{{ formatDateTime(row.lastRunAt) }}</span>
                        <NuxtLink
                            v-if="row.lastConversationId"
                            :to="`/chat/${encodeURIComponent(row.agentId)}?c=${encodeURIComponent(row.lastConversationId)}`"
                            class="text-hover-brand font-medium"
                        >
                            {{ t('work.openRunResult') }}
                        </NuxtLink>
                    </div>

                    <!-- 失败原因贴着这一行说：它是「为什么今天没出结果」的唯一线索，藏在详情里等于没有 -->
                    <p v-if="row.lastStatus === 'failed' && row.lastError" class="app-help-error">{{ row.lastError }}</p>
                </li>
            </ul>

            <div v-else-if="!loadFailed" class="app-empty">
                <AppIcon name="timer-outline" :size="30" class="app-empty-icon" />
                <p class="app-empty-title">{{ keyword || enabledFilter ? t('work.noSchedulesMatch') : t('work.noSchedulesYet') }}</p>
                <p class="app-empty-desc">{{ t('work.noSchedulesHint') }}</p>
            </div>
        </template>

        <template v-else>
            <div class="flex flex-wrap items-center gap-2">
                <button
                    v-for="filter in runFilters"
                    :key="filter.value || 'all'"
                    type="button"
                    class="app-chip"
                    :class="runStatus === filter.value ? 'app-chip-brand' : ''"
                    :aria-pressed="runStatus === filter.value"
                    @click="runStatus = filter.value"
                >
                    {{ filter.label }}
                </button>
                <span class="text-faint ml-auto text-[11px]">{{ runsData?.total ?? 0 }}</span>
            </div>

            <div v-if="runsLoadFailed" class="app-alert app-alert-danger flex items-center justify-between gap-3">
                <span>{{ t('runs.loadFailed') }}</span>
                <button type="button" class="app-btn app-btn-soft shrink-0 !py-1.5" @click="refreshRuns()">{{ t('common.retry') }}</button>
            </div>

            <div v-if="runsPending && !runRows.length" class="space-y-2">
                <div v-for="i in 5" :key="i" class="app-skeleton h-24" />
            </div>

            <div v-else-if="runRows.length" class="space-y-2">
                <NuxtLink
                    v-for="run in runRows"
                    :key="run.id"
                    :to="`/runs/${encodeURIComponent(run.id)}`"
                    class="app-card app-card-hover flex flex-col gap-2 p-4"
                >
                    <div class="flex items-start gap-3">
                        <span class="text-lg">{{ run.agentEmoji || '🤖' }}</span>
                        <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-strong truncate text-sm font-bold">{{ run.scheduleTitle }}</span>
                                <span class="app-badge" :class="runStatusClass(run.status)">{{ runStatusLabel(run.status) }}</span>
                                <span class="app-chip !text-[10px]">{{ runTriggerLabel(run.trigger) }}</span>
                            </div>
                            <p class="text-faint mt-1 line-clamp-1 text-[11px]">{{ run.prompt }}</p>
                        </div>
                        <span class="text-faint shrink-0 text-[10px]">{{ formatDateTime(run.startedAt) }}</span>
                    </div>
                    <div class="text-faint flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                        <span class="app-chip shrink-0 !px-1.5 !py-0 !text-[9px]" :class="run.spaceName ? 'app-chip-brand' : ''">
                            {{ run.spaceName || t('knowledge.global') }}
                        </span>
                        <span>{{ run.agentName || t('runs.agent') }}</span>
                        <span>{{ t('runs.duration') }} · {{ runDurationLabel(run.durationMs) }}</span>
                        <span v-if="run.outputConversationId" class="text-brand font-medium">{{ t('runs.openOutput') }}</span>
                    </div>
                    <p v-if="run.status === 'failed' && run.error" class="app-help-error line-clamp-2">{{ run.error }}</p>
                </NuxtLink>

                <div v-if="(runsData?.totalPages ?? 1) > 1" class="flex items-center justify-center gap-2 pt-2">
                    <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs" :disabled="runPage <= 1" @click="runPage--">←</button>
                    <span class="text-faint text-[11px]">{{ runPage }} / {{ runsData?.totalPages }}</span>
                    <button
                        type="button"
                        class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs"
                        :disabled="runPage >= (runsData?.totalPages ?? 1)"
                        @click="runPage++"
                    >
                        →
                    </button>
                </div>
            </div>

            <div v-else-if="!runsLoadFailed" class="app-empty">
                <AppIcon name="history" :size="30" class="app-empty-icon" />
                <p class="app-empty-title">{{ t('runs.empty') }}</p>
                <p class="app-empty-desc">{{ t('runs.emptyHint') }}</p>
            </div>
        </template>

        <AdminDrawer :open="drawerOpen" :title="editingId ? t('common.edit') : t('work.newSchedule')" width-class="sm:max-w-2xl" @close="drawerOpen = false">
            <div class="space-y-3">
                <input
                    v-model="form.title"
                    class="app-input"
                    :placeholder="t('work.scheduleTitlePlaceholder')"
                    :aria-label="t('work.fieldTitle')"
                    :maxlength="200"
                />
                <textarea
                    v-model="form.prompt"
                    rows="5"
                    class="app-input"
                    :placeholder="t('work.schedulePromptPlaceholder')"
                    :aria-label="t('work.fieldPrompt')"
                    :maxlength="SCHEDULE_PROMPT_MAX"
                />
                <p class="text-faint -mt-1 text-[11px]">{{ t('work.schedulePromptHint') }}</p>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <select v-model="form.agentId" class="app-input" :aria-label="t('work.fieldAgent')">
                        <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.emoji }} {{ agent.name }}</option>
                    </select>
                    <select v-model="form.spaceId" class="app-input" :aria-label="t('work.fieldSpace')">
                        <option value="">{{ t('work.globalSpace') }}</option>
                        <option v-for="space in spaces" :key="space.id" :value="space.id">{{ space.icon }} {{ space.name }}</option>
                    </select>
                </div>

                <p v-if="!form.spaceId" class="text-faint -mt-1 text-[11px]">{{ t('work.globalSpaceHint') }}</p>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <select v-model="form.kind" class="app-input" :aria-label="t('work.fieldRepeat')">
                        <option v-for="kind in SCHEDULE_KIND_OPTIONS" :key="kind" :value="kind">
                            {{
                                kind === 'daily'
                                    ? t('work.scheduleDaily')
                                    : kind === 'weekly'
                                      ? t('work.scheduleWeekly')
                                      : kind === 'interval'
                                        ? t('work.scheduleInterval')
                                        : t('work.scheduleOnce')
                            }}
                        </option>
                    </select>
                </div>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label class="text-soft flex items-center gap-2 text-xs">
                        <span class="shrink-0">{{ t('work.fieldStartDay') }}</span>
                        <input v-model="form.startDay" type="date" class="app-input flex-1" />
                    </label>
                    <label v-if="showClock" class="text-soft flex items-center gap-2 text-xs">
                        <span class="shrink-0">{{ t('work.fieldClock') }}</span>
                        <input v-model="form.time" type="time" class="app-input flex-1" />
                    </label>
                    <label v-if="showInterval" class="text-soft flex items-center gap-2 text-xs">
                        <span class="shrink-0">{{ t('work.fieldIntervalMinutes') }}</span>
                        <input
                            v-model.number="form.intervalMinutes"
                            type="number"
                            :min="INTERVAL_MINUTES_MIN"
                            :max="INTERVAL_MINUTES_MAX"
                            step="5"
                            class="app-input flex-1"
                        />
                    </label>
                </div>
                <p v-if="showInterval" class="text-faint -mt-1 text-[11px]">
                    {{ t('work.intervalHint', { min: INTERVAL_MINUTES_MIN, max: INTERVAL_MINUTES_MAX }) }}
                </p>

                <div v-if="showDays" class="flex flex-wrap items-center gap-1.5">
                    <button
                        v-for="index in 7"
                        :key="index"
                        type="button"
                        class="app-chip"
                        :class="form.days.includes(index - 1) ? 'app-chip-brand' : ''"
                        :aria-pressed="form.days.includes(index - 1)"
                        @click="toggleDay(index - 1)"
                    >
                        {{ weekdayName(index - 1) }}
                    </button>
                </div>

                <label class="text-soft flex items-center gap-1.5 text-sm">
                    <input v-model="form.enabled" type="checkbox" class="app-checkbox" />
                    {{ t('adminForm.enable') }}
                </label>

                <p v-if="formError" class="app-help-error">{{ formError }}</p>
            </div>
            <template #footer>
                <div class="flex w-full items-center gap-2">
                    <button v-if="editingId" type="button" class="app-btn app-btn-ghost !text-[color:var(--danger)]" @click="removeCurrent">
                        {{ t('common.delete') }}
                    </button>
                    <button type="button" class="app-btn app-btn-ghost ml-auto" :disabled="saving" @click="drawerOpen = false">
                        {{ t('adminForm.cancel') }}
                    </button>
                    <button type="button" class="app-btn app-btn-primary" :disabled="saving" @click="save">{{ t('adminForm.save') }}</button>
                </div>
            </template>
        </AdminDrawer>
    </div>
</template>
