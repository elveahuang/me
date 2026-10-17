<script setup lang="ts">
import { formatDateTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';

interface RunDetail {
    id: string;
    scheduleId: string;
    scheduleTitle: string;
    spaceId: string;
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
    attempt: number;
}

const { t } = useI18n();
const route = useRoute();
const id = computed(() => route.params.id as string);
const { data, error } = await useFetch<RunDetail>(() => `/api/runs/${encodeURIComponent(id.value)}`);

const statusLabel = computed(() =>
    data.value?.status === 'success' ? t('runs.success') : data.value?.status === 'failed' ? t('runs.failed') : t('runs.running'),
);
const statusClass = computed(() =>
    data.value?.status === 'success' ? 'app-badge-success' : data.value?.status === 'failed' ? 'app-badge-danger' : 'app-badge-info',
);
const triggerLabel = computed(() =>
    data.value?.trigger === 'manual' ? t('runs.triggerManual') : data.value?.trigger === 'retry' ? t('runs.triggerRetry') : t('runs.triggerSchedule'),
);
const durationLabel = computed(() => {
    const ms = data.value?.durationMs;
    if (ms === null || ms === undefined) return '—';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
});
</script>

<template>
    <div class="space-y-5">
        <NuxtLink to="/runs" class="text-faint text-hover-strong inline-flex items-center gap-1 text-xs">
            <span>←</span>
            <span>{{ t('runs.back') }}</span>
        </NuxtLink>

        <div v-if="error || !data" class="app-empty">
            <AppIcon name="alert-outline" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ t('runs.detailNotFound') }}</p>
        </div>

        <template v-else>
            <div class="app-page-header">
                <div>
                    <h1 class="app-page-title text-strong flex flex-wrap items-center gap-2">
                        <span>{{ data.scheduleTitle }}</span>
                        <span class="app-badge" :class="statusClass">{{ statusLabel }}</span>
                    </h1>
                    <p class="app-page-subtitle">{{ data.spaceName || '' }} · {{ data.agentEmoji || '🤖' }} {{ data.agentName || data.scheduleTitle }}</p>
                </div>
                <NuxtLink
                    v-if="data.outputConversationId"
                    :to="`/chat/${encodeURIComponent(data.agentId)}?c=${encodeURIComponent(data.outputConversationId)}`"
                    class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs"
                >
                    {{ t('runs.openOutput') }}
                </NuxtLink>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div class="app-card p-4">
                    <p class="text-faint text-[11px]">{{ t('runs.startedAt') }}</p>
                    <p class="text-strong mt-1 text-sm font-bold">{{ formatDateTime(data.startedAt) }}</p>
                </div>
                <div class="app-card p-4">
                    <p class="text-faint text-[11px]">{{ t('runs.duration') }}</p>
                    <p class="text-strong mt-1 text-sm font-bold">{{ durationLabel }}</p>
                </div>
                <div class="app-card p-4">
                    <p class="text-faint text-[11px]">{{ t('runs.trigger') }}</p>
                    <p class="text-strong mt-1 text-sm font-bold">{{ triggerLabel }}</p>
                </div>
                <div class="app-card p-4">
                    <p class="text-faint text-[11px]">{{ t('runs.scheduledFor') }}</p>
                    <p class="text-strong mt-1 text-sm font-bold">{{ data.scheduledFor ? formatDateTime(data.scheduledFor) : '—' }}</p>
                </div>
            </div>

            <section v-if="data.error" class="app-card border-[color:var(--danger)] p-4">
                <h2 class="text-sm font-black text-[color:var(--danger)]">{{ t('runs.error') }}</h2>
                <pre class="text-faint mt-2 text-xs break-words whitespace-pre-wrap">{{ data.error }}</pre>
            </section>

            <section class="app-card p-4">
                <h2 class="text-sm font-black">{{ t('runs.prompt') }}</h2>
                <pre class="text-soft mt-2 text-xs leading-relaxed break-words whitespace-pre-wrap">{{ data.prompt }}</pre>
            </section>

            <section v-if="!data.outputConversationId" class="app-card p-4">
                <p class="text-faint text-xs">{{ t('runs.noOutput') }}</p>
            </section>
        </template>
    </div>
</template>
