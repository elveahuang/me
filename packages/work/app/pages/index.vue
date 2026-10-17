<script setup lang="ts">
import { formatDateTime, formatTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 今日（`/`）：工作台首页。
 *
 * 这一页只读确定性事实：到点计划、失败/运行中的自动化、最近会话与工作空间。
 * 模型摘要不在这里默认生成——首页打开几十次，不该每次都产生一次真实外呼。
 */
interface OverviewCounts {
    enabledSchedules: number;
    dueToday: number;
    runningRuns: number;
    failedRunsToday: number;
    conversationsToday: number;
}
interface OverviewDue {
    id: string;
    title: string;
    agentId: string;
    agentName: string | null;
    agentEmoji: string | null;
    spaceId: string;
    spaceName: string | null;
    nextRunAt: string;
    lastStatus: string;
}
interface OverviewRun {
    id: string;
    scheduleId: string;
    scheduleTitle: string;
    spaceName: string | null;
    agentEmoji: string | null;
    agentName: string | null;
    status: 'running' | 'success' | 'failed';
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    outputConversationId: string | null;
    error: string;
}
interface OverviewConversation {
    id: string;
    title: string;
    agentId: string;
    agentName: string;
    agentEmoji: string | null;
    spaceId: string;
    spaceName: string | null;
    updatedAt: string;
}
interface OverviewSpace {
    id: string;
    name: string;
    description: string;
    icon: string;
    conversationCount?: number;
    scheduleCount?: number;
}
interface OverviewData {
    date: string;
    counts: OverviewCounts;
    dueToday: OverviewDue[];
    recentRuns: OverviewRun[];
    recentConversations: OverviewConversation[];
    spaces: OverviewSpace[];
}

const { t } = useI18n();
const { data, pending, error, refresh } = await useFetch<OverviewData>('/api/overview', { lazy: true });

const counts = computed<OverviewCounts>(
    () =>
        data.value?.counts ?? {
            enabledSchedules: 0,
            dueToday: 0,
            runningRuns: 0,
            failedRunsToday: 0,
            conversationsToday: 0,
        },
);
const attentionRuns = computed(() => (data.value?.recentRuns ?? []).filter((run) => run.status === 'failed' || run.status === 'running').slice(0, 6));
const dueToday = computed(() => data.value?.dueToday ?? []);
const recentRuns = computed(() => (data.value?.recentRuns ?? []).slice(0, 6));
const recentConversations = computed(() => data.value?.recentConversations ?? []);
const spaces = computed(() => (data.value?.spaces ?? []).slice(0, 6));
const loadFailed = computed(() => Boolean(error.value));
const stats = computed(() => [
    { key: 'running', label: t('overview.statRunning'), value: counts.value.runningRuns, tone: 'info' },
    { key: 'failed', label: t('overview.statFailed'), value: counts.value.failedRunsToday, tone: counts.value.failedRunsToday ? 'danger' : 'neutral' },
    { key: 'due', label: t('overview.statDue'), value: counts.value.dueToday, tone: 'brand' },
    { key: 'conversations', label: t('overview.statConversations'), value: counts.value.conversationsToday, tone: 'neutral' },
]);

function runPath(run: OverviewRun) {
    return `/runs/${encodeURIComponent(run.id)}`;
}
function conversationPath(conversation: OverviewConversation) {
    return `/chat/${encodeURIComponent(conversation.agentId)}?c=${encodeURIComponent(conversation.id)}`;
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
                <h1 class="app-page-title text-strong">{{ t('overview.title') }}</h1>
                <p class="app-page-subtitle">{{ t('overview.subtitle', { date: data?.date ?? '' }) }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <NuxtLink to="/chat" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs">
                    <AppIcon name="plus" :size="14" />
                    <span>{{ t('overview.newChat') }}</span>
                </NuxtLink>
                <NuxtLink to="/runs" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs">{{ t('overview.viewAllRuns') }}</NuxtLink>
                <NuxtLink to="/tasks" class="app-btn app-btn-ghost !px-3 !py-1.5 !text-xs">{{ t('overview.viewSchedules') }}</NuxtLink>
            </div>
        </div>

        <div v-if="loadFailed" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ t('common.loadFailed') }}</span>
            <button type="button" class="app-btn app-btn-soft shrink-0 !py-1.5" @click="refresh()">{{ t('common.retry') }}</button>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div v-for="stat in stats" :key="stat.key" class="app-card flex items-center justify-between gap-3 p-4">
                <div>
                    <p class="text-faint text-[11px] font-medium">{{ stat.label }}</p>
                    <p class="text-strong mt-1 text-2xl font-black">{{ pending ? '—' : stat.value }}</p>
                </div>
                <span
                    class="flex h-9 w-9 items-center justify-center rounded-full text-sm"
                    :class="
                        stat.tone === 'danger'
                            ? 'app-badge app-badge-danger'
                            : stat.tone === 'info'
                              ? 'app-badge app-badge-info'
                              : stat.tone === 'brand'
                                ? 'app-chip app-chip-brand'
                                : 'app-badge app-badge-neutral'
                    "
                >
                    {{ stat.key === 'running' ? '▶' : stat.key === 'failed' ? '!' : stat.key === 'due' ? '◷' : '💬' }}
                </span>
            </div>
        </div>

        <div class="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div class="space-y-5">
                <section class="app-card overflow-hidden">
                    <div class="border-line flex items-center justify-between gap-3 border-b px-4 py-3">
                        <h2 class="text-sm font-black">{{ t('overview.attentionTitle') }}</h2>
                        <NuxtLink to="/runs" class="text-hover-brand text-[11px] font-bold">{{ t('overview.viewAllRuns') }}</NuxtLink>
                    </div>
                    <div v-if="attentionRuns.length" class="divide-line divide-y">
                        <NuxtLink
                            v-for="run in attentionRuns"
                            :key="run.id"
                            :to="runPath(run)"
                            class="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--surface-3)]"
                        >
                            <span class="mt-0.5 text-base">{{ run.agentEmoji || '🤖' }}</span>
                            <span class="min-w-0 flex-1">
                                <span class="text-strong block truncate text-xs font-bold">{{ run.scheduleTitle }}</span>
                                <span class="text-faint mt-0.5 block truncate text-[11px]">
                                    {{ run.status === 'failed' ? run.error || t('runs.failed') : t('overview.runningRun', { title: run.scheduleTitle }) }}
                                </span>
                            </span>
                            <span class="app-badge shrink-0" :class="run.status === 'failed' ? 'app-badge-danger' : 'app-badge-info'">
                                {{ run.status === 'failed' ? t('runs.failed') : t('runs.running') }}
                            </span>
                        </NuxtLink>
                    </div>
                    <div v-else class="app-empty py-8">
                        <AppIcon name="check-circle-outline" :size="26" class="app-empty-icon" />
                        <p class="app-empty-desc">{{ t('overview.attentionEmpty') }}</p>
                    </div>
                </section>

                <section class="app-card overflow-hidden">
                    <div class="border-line flex items-center justify-between gap-3 border-b px-4 py-3">
                        <h2 class="text-sm font-black">{{ t('overview.recentRunsTitle') }}</h2>
                        <NuxtLink to="/runs" class="text-hover-brand text-[11px] font-bold">{{ t('overview.viewAllRuns') }}</NuxtLink>
                    </div>
                    <div v-if="recentRuns.length" class="divide-line divide-y">
                        <NuxtLink
                            v-for="run in recentRuns"
                            :key="run.id"
                            :to="runPath(run)"
                            class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--surface-3)]"
                        >
                            <span class="text-base">{{ run.agentEmoji || '🤖' }}</span>
                            <span class="min-w-0 flex-1">
                                <span class="text-strong block truncate text-xs font-bold">{{ run.scheduleTitle }}</span>
                                <span class="text-faint mt-0.5 block truncate text-[11px]">
                                    {{ formatDateTime(run.startedAt) }} · {{ durationLabel(run.durationMs) }}
                                </span>
                            </span>
                            <span
                                class="app-badge shrink-0"
                                :class="run.status === 'success' ? 'app-badge-success' : run.status === 'failed' ? 'app-badge-danger' : 'app-badge-info'"
                            >
                                {{ run.status === 'success' ? t('runs.success') : run.status === 'failed' ? t('runs.failed') : t('runs.running') }}
                            </span>
                        </NuxtLink>
                    </div>
                    <div v-else class="app-empty py-8">
                        <AppIcon name="history" :size="26" class="app-empty-icon" />
                        <p class="app-empty-desc">{{ t('overview.recentRunsEmpty') }}</p>
                    </div>
                </section>
            </div>

            <div class="space-y-5">
                <section class="app-card overflow-hidden">
                    <div class="border-line flex items-center justify-between gap-3 border-b px-4 py-3">
                        <h2 class="text-sm font-black">{{ t('overview.dueTitle') }}</h2>
                        <NuxtLink to="/tasks" class="text-hover-brand text-[11px] font-bold">{{ t('overview.viewSchedules') }}</NuxtLink>
                    </div>
                    <div v-if="dueToday.length" class="divide-line divide-y">
                        <NuxtLink
                            v-for="row in dueToday"
                            :key="row.id"
                            :to="`/tasks?id=${encodeURIComponent(row.id)}`"
                            class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--surface-3)]"
                        >
                            <span class="text-base">{{ row.agentEmoji || '⏱️' }}</span>
                            <span class="min-w-0 flex-1">
                                <span class="text-strong block truncate text-xs font-bold">{{ row.title }}</span>
                                <span class="text-faint mt-0.5 block truncate text-[11px]">{{ row.spaceName || row.agentName || '' }}</span>
                            </span>
                            <span class="text-brand shrink-0 text-[11px] font-bold">{{ formatTime(row.nextRunAt) }}</span>
                        </NuxtLink>
                    </div>
                    <div v-else class="app-empty py-8">
                        <AppIcon name="timer-outline" :size="26" class="app-empty-icon" />
                        <p class="app-empty-desc">{{ t('overview.dueEmpty') }}</p>
                    </div>
                </section>

                <section class="app-card overflow-hidden">
                    <div class="border-line flex items-center justify-between gap-3 border-b px-4 py-3">
                        <h2 class="text-sm font-black">{{ t('overview.recentConversationsTitle') }}</h2>
                        <NuxtLink to="/chat" class="text-hover-brand text-[11px] font-bold">{{ t('overview.newChat') }}</NuxtLink>
                    </div>
                    <div v-if="recentConversations.length" class="divide-line divide-y">
                        <NuxtLink
                            v-for="conversation in recentConversations"
                            :key="conversation.id"
                            :to="conversationPath(conversation)"
                            class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--surface-3)]"
                        >
                            <span class="text-base">{{ conversation.agentEmoji || '🤖' }}</span>
                            <span class="min-w-0 flex-1">
                                <span class="text-strong block truncate text-xs font-bold">{{ conversation.title }}</span>
                                <span class="text-faint mt-0.5 block truncate text-[11px]">{{ conversation.spaceName || conversation.agentName }}</span>
                            </span>
                            <span class="text-faint shrink-0 text-[10px]">{{ formatDateTime(conversation.updatedAt) }}</span>
                        </NuxtLink>
                    </div>
                    <div v-else class="app-empty py-8">
                        <AppIcon name="chat-outline" :size="26" class="app-empty-icon" />
                        <p class="app-empty-desc">{{ t('overview.recentConversationsEmpty') }}</p>
                    </div>
                </section>

                <section class="app-card overflow-hidden">
                    <div class="border-line flex items-center justify-between gap-3 border-b px-4 py-3">
                        <h2 class="text-sm font-black">{{ t('overview.spacesTitle') }}</h2>
                        <NuxtLink to="/spaces" class="text-hover-brand text-[11px] font-bold">{{ t('spaces.openChat') }}</NuxtLink>
                    </div>
                    <div v-if="spaces.length" class="divide-line divide-y">
                        <NuxtLink
                            v-for="space in spaces"
                            :key="space.id"
                            to="/spaces"
                            class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--surface-3)]"
                        >
                            <span class="text-lg">{{ space.icon }}</span>
                            <span class="min-w-0 flex-1">
                                <span class="text-strong block truncate text-xs font-bold">{{ space.name }}</span>
                                <span class="text-faint mt-0.5 block truncate text-[11px]">{{ space.description || t('common.none') }}</span>
                            </span>
                        </NuxtLink>
                    </div>
                    <div v-else class="app-empty py-8">
                        <AppIcon name="folder-outline" :size="26" class="app-empty-icon" />
                        <p class="app-empty-desc">{{ t('overview.spacesEmpty') }}</p>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>
