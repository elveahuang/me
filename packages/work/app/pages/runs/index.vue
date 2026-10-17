<script setup lang="ts">
import { formatDateTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';

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

/** 运行中心：每一次自动化执行一条记录，而不是被 schedules.last_* 覆盖。 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const status = ref(typeof route.query.status === 'string' ? route.query.status : '');
const page = ref(1);

watch(status, () => {
    page.value = 1;
    void router.replace({ query: { ...route.query, status: status.value || undefined } });
});

const query = computed(() => ({ status: status.value || undefined, page: page.value, pageSize: 30 }));
const { data, pending, error, refresh } = await useFetch<RunsResponse>('/api/runs', {
    query,
    lazy: true,
    default: () => ({ runs: [], page: 1, pageSize: 30, total: 0, totalPages: 1 }),
});

const rows = computed(() => data.value?.runs ?? []);
const loadFailed = computed(() => Boolean(error.value));
const filters = computed(() => [
    { value: '', label: t('runs.all') },
    { value: 'running', label: t('runs.running') },
    { value: 'success', label: t('runs.success') },
    { value: 'failed', label: t('runs.failed') },
]);

function statusLabel(value: string) {
    return value === 'success' ? t('runs.success') : value === 'failed' ? t('runs.failed') : t('runs.running');
}
function statusClass(value: string) {
    return value === 'success' ? 'app-badge-success' : value === 'failed' ? 'app-badge-danger' : 'app-badge-info';
}
function triggerLabel(value: string) {
    return value === 'manual' ? t('runs.triggerManual') : value === 'retry' ? t('runs.triggerRetry') : t('runs.triggerSchedule');
}
function durationLabel(ms: number | null) {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('runs.title') }}</h1>
                <p class="app-page-subtitle">{{ t('runs.subtitle') }}</p>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" class="app-btn app-btn-ghost !px-3 !py-1.5 !text-xs" @click="refresh()">{{ t('common.retry') }}</button>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <button
                v-for="filter in filters"
                :key="filter.value || 'all'"
                type="button"
                class="app-chip"
                :class="status === filter.value ? 'app-chip-brand' : ''"
                :aria-pressed="status === filter.value"
                @click="status = filter.value"
            >
                {{ filter.label }}
            </button>
            <span class="text-faint ml-auto text-[11px]">{{ data?.total ?? 0 }}</span>
        </div>

        <div v-if="loadFailed" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ t('runs.loadFailed') }}</span>
            <button type="button" class="app-btn app-btn-soft shrink-0 !py-1.5" @click="refresh()">{{ t('common.retry') }}</button>
        </div>

        <div v-if="pending && !rows.length" class="space-y-2">
            <div v-for="i in 5" :key="i" class="app-skeleton h-24" />
        </div>

        <div v-else-if="rows.length" class="space-y-2">
            <NuxtLink v-for="run in rows" :key="run.id" :to="`/runs/${encodeURIComponent(run.id)}`" class="app-card app-card-hover flex flex-col gap-2 p-4">
                <div class="flex items-start gap-3">
                    <span class="text-lg">{{ run.agentEmoji || '🤖' }}</span>
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-strong truncate text-sm font-bold">{{ run.scheduleTitle }}</span>
                            <span class="app-badge" :class="statusClass(run.status)">{{ statusLabel(run.status) }}</span>
                            <span class="app-chip !text-[10px]">{{ triggerLabel(run.trigger) }}</span>
                        </div>
                        <p class="text-faint mt-1 line-clamp-1 text-[11px]">{{ run.prompt }}</p>
                    </div>
                    <span class="text-faint shrink-0 text-[10px]">{{ formatDateTime(run.startedAt) }}</span>
                </div>
                <div class="text-faint flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                    <span>{{ run.spaceName || t('runs.space') }}</span>
                    <span>{{ run.agentName || t('runs.agent') }}</span>
                    <span>{{ t('runs.duration') }} · {{ durationLabel(run.durationMs) }}</span>
                    <span v-if="run.outputConversationId" class="text-brand font-medium">{{ t('runs.openOutput') }}</span>
                </div>
                <p v-if="run.status === 'failed' && run.error" class="app-help-error line-clamp-2">{{ run.error }}</p>
            </NuxtLink>

            <div v-if="(data?.totalPages ?? 1) > 1" class="flex items-center justify-center gap-2 pt-2">
                <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs" :disabled="page <= 1" @click="page--">←</button>
                <span class="text-faint text-[11px]">{{ page }} / {{ data?.totalPages }}</span>
                <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs" :disabled="page >= (data?.totalPages ?? 1)" @click="page++">
                    →
                </button>
            </div>
        </div>

        <div v-else-if="!loadFailed" class="app-empty">
            <AppIcon name="history" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ t('runs.empty') }}</p>
            <p class="app-empty-desc">{{ t('runs.emptyHint') }}</p>
        </div>
    </div>
</template>
