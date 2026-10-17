<script setup lang="ts">
import { formatDateTime, type AttachmentsResponse } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import type { WorkConversationSummary, WorkSchedule } from '../../utils/work';

interface SpaceDetail {
    id: string;
    name: string;
    description: string;
    icon: string;
    instructions: string;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
    conversationCount: number;
    scheduleCount: number;
    attachmentCount: number;
    knowledgeBaseCount: number;
    documentCount: number;
}
interface RunRow {
    id: string;
    scheduleTitle: string;
    status: string;
    startedAt: string;
}
interface RunsResponse {
    runs: RunRow[];
    total: number;
}
interface KbItem {
    id: string;
    name: string;
    description: string;
    documentCount: number;
    chunkCount: number;
}

const { t } = useI18n();
const route = useRoute();
const id = computed(() => route.params.id as string);
const keyword = ref('');

const { data: space, error: spaceError, refresh: refreshSpace } = await useFetch<SpaceDetail>(() => `/api/spaces/${encodeURIComponent(id.value)}`);
const { data: conversations, refresh: refreshConversations } = await useFetch<WorkConversationSummary[]>('/api/conversations', {
    query: computed(() => ({ spaceId: id.value, limit: 20 })),
    default: () => [],
});
const { data: schedules, refresh: refreshSchedules } = await useFetch<WorkSchedule[]>('/api/schedules', {
    query: computed(() => ({ spaceId: id.value, limit: 50 })),
    default: () => [],
});
const { data: attachmentData, refresh: refreshAttachments } = await useFetch<AttachmentsResponse>('/api/attachments', {
    query: computed(() => ({ spaceId: id.value, pageSize: 12 })),
    default: () => ({ attachments: [], total: 0, page: 1, pageSize: 12 }),
});
const { data: kbs, refresh: refreshKbs } = await useFetch<KbItem[]>('/api/settings/knowledge-bases', {
    query: computed(() => ({ spaceId: id.value })),
    default: () => [],
});
const { data: runData, refresh: refreshRuns } = await useFetch<RunsResponse>('/api/runs', {
    query: computed(() => ({ spaceId: id.value, pageSize: 10 })),
    default: () => ({ runs: [], total: 0 }),
});

watch(id, () => {
    void Promise.all([refreshSpace(), refreshConversations(), refreshSchedules(), refreshAttachments(), refreshKbs(), refreshRuns()]);
});

const attachments = computed(() => attachmentData.value?.attachments ?? []);
const scheduleRows = computed(() => schedules.value ?? []);
const conversationRows = computed(() => conversations.value ?? []);
const kbRows = computed(() => kbs.value ?? []);
const runs = computed(() => runData.value?.runs ?? []);
const normalizedKeyword = computed(() => keyword.value.trim().toLowerCase());
const matches = (...values: Array<string | null | undefined>) =>
    !normalizedKeyword.value || values.some((value) => (value ?? '').toLowerCase().includes(normalizedKeyword.value));
const filteredAttachments = computed(() => attachments.value.filter((file) => matches(file.filename)));
const filteredSchedules = computed(() => scheduleRows.value.filter((schedule) => matches(schedule.title, schedule.prompt, schedule.agentName)));
const filteredConversations = computed(() => conversationRows.value.filter((conversation) => matches(conversation.title, conversation.agentName)));
const filteredKbRows = computed(() => kbRows.value.filter((kb) => matches(kb.name, kb.description)));
const filteredRuns = computed(() => runs.value.filter((run) => matches(run.scheduleTitle)));

function conversationPath(conversation: WorkConversationSummary) {
    return `/chat/${encodeURIComponent(conversation.agentId)}?c=${encodeURIComponent(conversation.id)}`;
}
</script>

<template>
    <div class="space-y-5">
        <div v-if="spaceError || !space" class="app-empty">
            <AppIcon name="alert-outline" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ t('spaceDetail.notFound') }}</p>
            <NuxtLink to="/spaces" class="app-btn app-btn-outline mt-3">{{ t('spaceDetail.back') }}</NuxtLink>
        </div>

        <template v-else>
            <div class="app-page-header">
                <div class="flex min-w-0 items-start gap-3">
                    <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--surface-3)] text-2xl">{{ space.icon }}</span>
                    <div class="min-w-0">
                        <h1 class="app-page-title text-strong flex flex-wrap items-center gap-2">
                            <span class="truncate">{{ space.name }}</span>
                            <span v-if="space.archived" class="app-badge app-badge-neutral !text-[10px]">{{ t('spaces.archived') }}</span>
                        </h1>
                        <p class="app-page-subtitle">{{ space.description || t('spaceDetail.noDescription') }}</p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <input
                        v-model="keyword"
                        class="app-input !w-44 !text-xs"
                        :placeholder="t('spaceDetail.searchPlaceholder')"
                        :aria-label="t('spaceDetail.searchPlaceholder')"
                    />
                    <NuxtLink v-if="!space.archived" :to="`/chat?space=${encodeURIComponent(space.id)}`" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs">
                        <AppIcon name="plus" :size="14" />
                        <span>{{ t('spaceDetail.newChat') }}</span>
                    </NuxtLink>
                    <NuxtLink to="/spaces" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs">{{ t('spaceDetail.manage') }}</NuxtLink>
                </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
                <div
                    v-for="stat in [
                        { label: t('spaces.conversations', { n: space.conversationCount }), value: space.conversationCount },
                        { label: t('spaces.schedules', { n: space.scheduleCount }), value: space.scheduleCount },
                        { label: t('spaces.files', { n: space.attachmentCount }), value: space.attachmentCount },
                        { label: t('spaces.knowledgeBases', { n: space.knowledgeBaseCount }), value: space.knowledgeBaseCount },
                        { label: t('spaces.documents', { n: space.documentCount }), value: space.documentCount },
                    ]"
                    :key="stat.label"
                    class="app-card p-4"
                >
                    <p class="text-faint text-[11px]">{{ stat.label }}</p>
                    <p class="text-strong mt-1 text-2xl font-black">{{ stat.value }}</p>
                </div>
            </div>

            <section v-if="space.instructions" class="app-card p-4">
                <h2 class="text-sm font-black">{{ t('spaceDetail.instructions') }}</h2>
                <pre class="text-soft mt-2 text-xs leading-relaxed break-words whitespace-pre-wrap">{{ space.instructions }}</pre>
            </section>

            <div class="text-faint flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
                <span>{{ t('spaceDetail.createdAt') }} {{ formatDateTime(space.createdAt) }}</span>
                <span>{{ t('spaceDetail.updatedAt') }} {{ formatDateTime(space.updatedAt) }}</span>
            </div>

            <div class="grid gap-5 xl:grid-cols-2">
                <section class="app-card overflow-hidden">
                    <div class="border-line flex items-center justify-between border-b px-4 py-3">
                        <h2 class="text-sm font-black">{{ t('spaceDetail.conversations') }}</h2>
                        <NuxtLink :to="`/chat?space=${encodeURIComponent(space.id)}`" class="text-hover-brand text-[11px] font-bold">{{
                            t('spaceDetail.newChat')
                        }}</NuxtLink>
                    </div>
                    <div v-if="filteredConversations.length" class="divide-line divide-y">
                        <NuxtLink
                            v-for="conversation in filteredConversations"
                            :key="conversation.id"
                            :to="conversationPath(conversation)"
                            class="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--surface-3)]"
                        >
                            <span class="text-base">{{ conversation.agentEmoji || '💬' }}</span>
                            <span class="min-w-0 flex-1">
                                <span class="text-strong block truncate text-xs font-bold">{{ conversation.title }}</span>
                                <span class="text-faint mt-0.5 block truncate text-[10px]"
                                    >{{ conversation.agentName }} · {{ formatDateTime(conversation.updatedAt) }}</span
                                >
                            </span>
                        </NuxtLink>
                    </div>
                    <div v-else class="app-empty py-8">
                        <p class="app-empty-desc">{{ keyword ? t('spaceDetail.noMatches') : t('spaceDetail.noConversations') }}</p>
                    </div>
                </section>

                <section class="app-card overflow-hidden">
                    <div class="border-line flex items-center justify-between border-b px-4 py-3">
                        <h2 class="text-sm font-black">{{ t('spaceDetail.automations') }}</h2>
                        <NuxtLink to="/tasks" class="text-hover-brand text-[11px] font-bold">{{ t('spaceDetail.manage') }}</NuxtLink>
                    </div>
                    <div v-if="filteredSchedules.length" class="divide-line divide-y">
                        <NuxtLink
                            v-for="schedule in filteredSchedules.slice(0, 6)"
                            :key="schedule.id"
                            :to="`/tasks?id=${encodeURIComponent(schedule.id)}`"
                            class="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--surface-3)]"
                        >
                            <span class="text-base">{{ schedule.agentEmoji || '⏱️' }}</span>
                            <span class="min-w-0 flex-1">
                                <span class="text-strong block truncate text-xs font-bold">{{ schedule.title }}</span>
                                <span class="text-faint mt-0.5 block truncate text-[10px]"
                                    >{{ schedule.agentName }} · {{ schedule.enabled ? t('common.enabled') : t('common.disabled') }}</span
                                >
                            </span>
                            <span class="app-badge" :class="schedule.enabled ? 'app-badge-success' : 'app-badge-neutral'">{{
                                schedule.enabled ? t('common.enabled') : t('common.disabled')
                            }}</span>
                        </NuxtLink>
                    </div>
                    <div v-else class="app-empty py-8">
                        <p class="app-empty-desc">{{ keyword ? t('spaceDetail.noMatches') : t('spaceDetail.noAutomations') }}</p>
                    </div>
                </section>

                <section class="app-card overflow-hidden">
                    <div class="border-line flex items-center justify-between border-b px-4 py-3">
                        <h2 class="text-sm font-black">{{ t('spaceDetail.files') }}</h2>
                        <NuxtLink :to="`/library?space=${encodeURIComponent(space.id)}&tab=files`" class="text-hover-brand text-[11px] font-bold">{{
                            t('spaceDetail.manage')
                        }}</NuxtLink>
                    </div>
                    <div v-if="filteredAttachments.length" class="grid gap-2 p-3 sm:grid-cols-2">
                        <a
                            v-for="file in filteredAttachments"
                            :key="file.id"
                            :href="file.url || undefined"
                            target="_blank"
                            rel="noreferrer"
                            class="app-card flex items-center gap-2 p-2.5"
                        >
                            <AppIcon :name="file.isImage ? 'file-image-outline' : 'file-outline'" :size="16" />
                            <span class="min-w-0 flex-1 truncate text-[11px]">{{ file.filename }}</span>
                        </a>
                    </div>
                    <div v-else class="app-empty py-8">
                        <p class="app-empty-desc">{{ keyword ? t('spaceDetail.noMatches') : t('spaceDetail.noFiles') }}</p>
                    </div>
                </section>

                <section class="app-card overflow-hidden">
                    <div class="border-line flex items-center justify-between border-b px-4 py-3">
                        <h2 class="text-sm font-black">{{ t('spaceDetail.knowledge') }}</h2>
                        <NuxtLink :to="`/settings/knowledge?spaceId=${encodeURIComponent(space.id)}`" class="text-hover-brand text-[11px] font-bold">{{
                            t('spaceDetail.manage')
                        }}</NuxtLink>
                    </div>
                    <div v-if="filteredKbRows.length" class="divide-line divide-y">
                        <NuxtLink
                            v-for="kb in filteredKbRows"
                            :key="kb.id"
                            :to="`/settings/knowledge/${encodeURIComponent(kb.id)}`"
                            class="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--surface-3)]"
                        >
                            <span class="text-base">📚</span>
                            <span class="min-w-0 flex-1">
                                <span class="text-strong block truncate text-xs font-bold">{{ kb.name }}</span>
                                <span class="text-faint mt-0.5 block truncate text-[10px]"
                                    >{{ t('library.documents', { n: kb.documentCount }) }} · {{ t('library.chunks', { n: kb.chunkCount }) }}</span
                                >
                            </span>
                        </NuxtLink>
                    </div>
                    <div v-else class="app-empty py-8">
                        <p class="app-empty-desc">{{ keyword ? t('spaceDetail.noMatches') : t('spaceDetail.noKnowledge') }}</p>
                    </div>
                </section>
            </div>

            <section class="app-card overflow-hidden">
                <div class="border-line flex items-center justify-between border-b px-4 py-3">
                    <h2 class="text-sm font-black">{{ t('spaceDetail.runs') }}</h2>
                    <span class="text-faint text-[11px]">{{ runData?.total ?? 0 }}</span>
                </div>
                <div v-if="filteredRuns.length" class="divide-line divide-y">
                    <NuxtLink
                        v-for="run in filteredRuns"
                        :key="run.id"
                        :to="`/runs/${encodeURIComponent(run.id)}`"
                        class="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--surface-3)]"
                    >
                        <span class="min-w-0 flex-1">
                            <span class="text-strong block truncate text-xs font-bold">{{ run.scheduleTitle }}</span>
                            <span class="text-faint mt-0.5 block truncate text-[10px]">{{ formatDateTime(run.startedAt) }}</span>
                        </span>
                        <span
                            class="app-badge"
                            :class="run.status === 'success' ? 'app-badge-success' : run.status === 'failed' ? 'app-badge-danger' : 'app-badge-info'"
                            >{{ run.status }}</span
                        >
                    </NuxtLink>
                </div>
                <div v-else class="app-empty py-8">
                    <p class="app-empty-desc">{{ keyword ? t('spaceDetail.noMatches') : t('spaceDetail.noRuns') }}</p>
                </div>
            </section>
        </template>
    </div>
</template>
