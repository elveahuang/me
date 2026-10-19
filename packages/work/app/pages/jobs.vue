<script setup lang="ts">
import { useI18n } from 'vue-i18n';

interface JobRow {
    id: string;
    conversationId: string | null;
    command: string;
    cwd: string;
    status: 'running' | 'completed' | 'failed' | 'killed' | 'interrupted';
    exitCode: number | null;
    error: string;
    outputBytes: number;
    createdAt: string;
    finishedAt: string | null;
}

interface JobsResponse {
    jobs: JobRow[];
}

const { t } = useI18n();
const { data, pending, error, refresh } = await useFetch<JobsResponse>('/api/jobs', {
    lazy: true,
    default: () => ({ jobs: [] }),
});

const jobs = computed(() => data.value?.jobs ?? []);
const openId = ref<string | null>(null);
const outputText = ref('');
const outputLoading = ref(false);
const killingId = ref<string | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

function statusLabel(status: JobRow['status']) {
    return t(`jobs.${status}`);
}
function statusClass(status: JobRow['status']) {
    if (status === 'completed') return 'app-badge-success';
    if (status === 'failed' || status === 'interrupted') return 'app-badge-danger';
    if (status === 'killed') return 'app-badge-warning';
    return 'app-badge-info';
}
function formatTime(value: string) {
    return new Date(value).toLocaleString();
}

async function toggleOutput(job: JobRow) {
    if (openId.value === job.id) {
        openId.value = null;
        return;
    }
    openId.value = job.id;
    outputText.value = '';
    outputLoading.value = true;
    try {
        const result = await $fetch<{ chunks: { seq: number; stream: string; content: string }[] }>(`/api/jobs/${encodeURIComponent(job.id)}`);
        outputText.value = result.chunks.map((chunk) => `[${chunk.stream}] ${chunk.content}`).join('');
    } catch {
        outputText.value = t('jobs.loadFailed');
    } finally {
        outputLoading.value = false;
    }
}

async function kill(job: JobRow) {
    if (killingId.value) return;
    killingId.value = job.id;
    try {
        await $fetch(`/api/jobs/${encodeURIComponent(job.id)}/kill`, { method: 'POST' });
        await refresh();
    } catch {
        // 409 表示刚好结束；刷新后状态即可解释
        await refresh();
    } finally {
        killingId.value = null;
    }
}

onMounted(() => {
    timer = setInterval(() => {
        if (!killingId.value) void refresh();
    }, 3000);
});
onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
});
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('jobs.title') }}</h1>
                <p class="app-page-subtitle">{{ t('jobs.subtitle') }}</p>
            </div>
        </div>

        <div v-if="error" class="app-card app-text-danger p-4 text-sm">{{ t('jobs.loadFailed') }}</div>

        <div v-else-if="pending && !jobs.length" class="app-card app-text-muted p-6 text-sm">{{ t('common.loading') }}</div>

        <div v-else-if="!jobs.length" class="app-empty">
            <p class="text-strong">{{ t('jobs.empty') }}</p>
            <p class="app-text-muted mt-1 text-sm">{{ t('jobs.emptyHint') }}</p>
        </div>

        <div v-else class="space-y-3">
            <article v-for="job in jobs" :key="job.id" class="app-card p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0 space-y-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="app-badge" :class="statusClass(job.status)">{{ statusLabel(job.status) }}</span>
                            <code class="app-text-muted text-xs">{{ job.id }}</code>
                        </div>
                        <p class="text-strong font-mono text-sm break-all">{{ job.command }}</p>
                        <p class="app-text-muted text-xs break-all">{{ job.cwd }}</p>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                        <button v-if="job.status === 'running'" class="app-btn app-btn-sm" :disabled="killingId === job.id" @click="kill(job)">
                            {{ t('jobs.kill') }}
                        </button>
                        <button class="app-btn app-btn-sm" @click="toggleOutput(job)">
                            {{ openId === job.id ? t('jobs.hideOutput') : t('jobs.viewOutput') }}
                        </button>
                    </div>
                </div>

                <div class="app-text-muted mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                    <span>{{ t('jobs.created') }}: {{ formatTime(job.createdAt) }}</span>
                    <span>{{ t('jobs.exitCode') }}: {{ job.exitCode ?? '—' }}</span>
                    <span v-if="job.error">{{ job.error }}</span>
                </div>

                <pre v-if="openId === job.id" class="mt-3 max-h-80 overflow-auto rounded-md bg-black/5 p-3 text-xs whitespace-pre-wrap">{{
                    outputLoading ? t('common.loading') : outputText || t('jobs.noOutput')
                }}</pre>
            </article>
        </div>
    </div>
</template>
