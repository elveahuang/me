<script setup lang="ts">
import { formatBytes, formatDateTime, type AttachmentsResponse } from '@commons/contract';
import { useI18n } from 'vue-i18n';

interface KbItem {
    id: string;
    spaceId: string;
    spaceName?: string | null;
    name: string;
    description: string;
    embeddingModel: string;
    providerName?: string | null;
    documentCount: number;
    chunkCount: number;
}

/**
 * 资料库：把聊天附件与知识库放到同一个用户入口。
 *
 * 这一版不复制管理能力：附件仍走 `/api/attachments`（预签名地址由服务端生成），
 * 知识库仍以 `/settings/knowledge` 为编辑面；资料库负责发现、搜索和跳转。
 */
const { t } = useI18n();
const { activeSpaceId, spaces } = useChatSidebar();
const keyword = ref('');
const tab = ref<'all' | 'files' | 'knowledge'>('all');

const attachmentQuery = computed(() => ({
    pageSize: 60,
    keyword: keyword.value.trim() || undefined,
    spaceId: activeSpaceId.value || undefined,
}));
const {
    data: attachmentData,
    pending: attachmentsPending,
    error: attachmentsError,
    refresh: refreshAttachments,
} = await useFetch<AttachmentsResponse>('/api/attachments', {
    query: attachmentQuery,
    lazy: true,
    default: () => ({ attachments: [], total: 0, page: 1, pageSize: 60 }),
});
const {
    data: kbRows,
    pending: kbsPending,
    error: kbsError,
    refresh: refreshKbs,
} = await useFetch<KbItem[]>('/api/settings/knowledge-bases', {
    lazy: true,
    default: () => [],
});

const attachments = computed(() => attachmentData.value?.attachments ?? []);
const kbs = computed(() => {
    const q = keyword.value.trim().toLowerCase();
    if (!q) return kbRows.value;
    return kbRows.value.filter((kb) => kb.name.toLowerCase().includes(q) || kb.description.toLowerCase().includes(q));
});
const totalDocs = computed(() => kbRows.value.reduce((sum, kb) => sum + kb.documentCount, 0));
const totalChunks = computed(() => kbRows.value.reduce((sum, kb) => sum + kb.chunkCount, 0));
const currentSpaceName = computed(() => spaces.value.find((space) => space.id === activeSpaceId.value)?.name ?? null);
const loading = computed(() => attachmentsPending.value || kbsPending.value);
const hasError = computed(() => Boolean(attachmentsError.value || kbsError.value));
const showFiles = computed(() => tab.value !== 'knowledge');
const showKnowledge = computed(() => tab.value !== 'files');
const tabs = computed(() => [
    { value: 'all' as const, label: t('common.all') },
    { value: 'files' as const, label: t('library.files') },
    { value: 'knowledge' as const, label: t('library.knowledge') },
]);

function refreshAll() {
    void refreshAttachments();
    void refreshKbs();
}
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('library.title') }}</h1>
                <p class="app-page-subtitle">{{ t('library.subtitle') }}</p>
                <span v-if="currentSpaceName" class="app-chip app-chip-brand mt-2 !text-[10px]">🗂️ {{ currentSpaceName }}</span>
            </div>
            <div class="flex items-center gap-2">
                <NuxtLink to="/chat" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs">
                    <AppIcon name="paperclip" :size="14" />
                    <span>{{ t('library.uploadFromChat') }}</span>
                </NuxtLink>
                <button type="button" class="app-btn app-btn-ghost !px-3 !py-1.5 !text-xs" @click="refreshAll">
                    <AppIcon name="autorenew" :size="14" />
                    <span>{{ t('common.retry') }}</span>
                </button>
            </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-3">
            <div class="app-card p-4">
                <p class="text-faint text-[11px]">{{ t('library.fileCount') }}</p>
                <p class="text-strong mt-1 text-2xl font-black">{{ attachmentData?.total ?? 0 }}</p>
            </div>
            <div class="app-card p-4">
                <p class="text-faint text-[11px]">{{ t('library.knowledgeCount') }}</p>
                <p class="text-strong mt-1 text-2xl font-black">{{ kbRows.length }}</p>
            </div>
            <div class="app-card p-4">
                <p class="text-faint text-[11px]">{{ t('library.documentCount') }}</p>
                <p class="text-strong mt-1 text-2xl font-black">
                    {{ totalDocs }} <span class="text-faint text-xs font-normal">/ {{ totalChunks }} chunks</span>
                </p>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <div class="relative min-w-0 flex-1 sm:max-w-sm">
                <AppIcon name="magnify" :size="15" class="text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                <input
                    v-model="keyword"
                    class="app-input !pl-8 !text-xs"
                    :placeholder="t('library.searchPlaceholder')"
                    :aria-label="t('library.searchPlaceholder')"
                />
            </div>
            <button
                v-for="item in tabs"
                :key="item.value"
                type="button"
                class="app-chip"
                :class="tab === item.value ? 'app-chip-brand' : ''"
                :aria-pressed="tab === item.value"
                @click="tab = item.value"
            >
                {{ item.label }}
            </button>
        </div>

        <div v-if="hasError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ t('library.loadFailed') }}</span>
            <button type="button" class="app-btn app-btn-soft shrink-0 !py-1.5" @click="refreshAll">{{ t('common.retry') }}</button>
        </div>

        <div v-if="loading && !attachments.length && !kbRows.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div v-for="i in 6" :key="i" class="app-skeleton app-skeleton-card" />
        </div>

        <template v-else>
            <section v-if="showFiles" class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                    <h2 class="text-sm font-black">{{ t('library.files') }}</h2>
                    <span class="text-faint text-[11px]">{{ attachments.length }} / {{ attachmentData?.total ?? 0 }}</span>
                </div>
                <div v-if="attachments.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <a
                        v-for="file in attachments"
                        :key="file.id"
                        :href="file.url || undefined"
                        target="_blank"
                        rel="noreferrer"
                        class="app-card app-card-hover flex flex-col gap-3 p-4"
                        :class="!file.url ? 'pointer-events-none opacity-70' : ''"
                    >
                        <div class="flex items-start gap-3">
                            <span class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[color:var(--surface-3)]">
                                <img v-if="file.isImage && file.url" :src="file.url" :alt="file.filename" class="h-full w-full object-cover" />
                                <AppIcon v-else :name="file.isImage ? 'file-image-outline' : 'file-outline'" :size="21" />
                            </span>
                            <div class="min-w-0 flex-1">
                                <p class="text-strong truncate text-xs font-bold" :title="file.filename">{{ file.filename }}</p>
                                <p class="text-faint mt-1 text-[10px]">{{ file.mimeType || t('common.none') }}</p>
                            </div>
                        </div>
                        <div class="text-faint mt-auto flex items-center justify-between gap-2 text-[10px]">
                            <span>{{ formatBytes(file.size) }}</span>
                            <span>{{ formatDateTime(file.createdAt) }}</span>
                        </div>
                    </a>
                </div>
                <div v-else class="app-empty">
                    <AppIcon name="file-outline" :size="28" class="app-empty-icon" />
                    <p class="app-empty-title">{{ t('library.noFiles') }}</p>
                    <p class="app-empty-desc">{{ t('library.noFilesHint') }}</p>
                </div>
            </section>

            <section v-if="showKnowledge" class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                    <h2 class="text-sm font-black">{{ t('library.knowledge') }}</h2>
                    <NuxtLink to="/settings/knowledge" class="text-hover-brand text-[11px] font-bold">{{ t('library.manageKnowledge') }}</NuxtLink>
                </div>
                <div v-if="kbs.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <NuxtLink v-for="kb in kbs" :key="kb.id" to="/settings/knowledge" class="app-card app-card-hover flex flex-col gap-3 p-4">
                        <div class="flex items-start gap-3">
                            <span class="app-avatar-icon h-11 w-11 shrink-0 text-xl">📚</span>
                            <div class="min-w-0 flex-1">
                                <p class="text-strong truncate text-xs font-bold">{{ kb.name }}</p>
                                <p class="text-faint mt-1 line-clamp-2 text-[10px]">{{ kb.description || t('common.none') }}</p>
                            </div>
                        </div>
                        <div class="text-faint mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                            <span>{{ t('library.documents', { n: kb.documentCount }) }}</span>
                            <span>{{ t('library.chunks', { n: kb.chunkCount }) }}</span>
                            <span class="font-mono">{{ kb.embeddingModel }}</span>
                        </div>
                    </NuxtLink>
                </div>
                <div v-else class="app-empty">
                    <AppIcon name="book-open-page-variant-outline" :size="28" class="app-empty-icon" />
                    <p class="app-empty-title">{{ t('library.noKnowledge') }}</p>
                    <p class="app-empty-desc">{{ t('library.noKnowledgeHint') }}</p>
                </div>
            </section>
        </template>
    </div>
</template>
