<script setup lang="ts">
import { extractApiError, formatBytes, formatDateTime, type AttachmentsResponse } from '@commons/contract';
import { useI18n } from 'vue-i18n';

interface KbItem {
    id: string;
    spaceId: string | null;
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
const route = useRoute();
const router = useRouter();
const { spaces } = useChatSidebar();

type LibraryTab = 'all' | 'files' | 'knowledge';
function queryText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
function queryPage(value: unknown): number {
    const parsed = Number.parseInt(queryText(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
function queryTab(value: unknown): LibraryTab {
    return value === 'files' || value === 'knowledge' ? value : 'all';
}

const keyword = ref(queryText(route.query.q));
const page = ref(queryPage(route.query.page));
const pageSize = 24;
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadError = ref('');
const tab = ref<LibraryTab>(queryTab(route.query.tab));
const spaceFilter = ref(queryText(route.query.space));

const attachmentQuery = computed(() => ({
    page: page.value,
    pageSize,
    keyword: keyword.value.trim() || undefined,
    spaceId: spaceFilter.value || undefined,
}));
const {
    data: attachmentData,
    pending: attachmentsPending,
    error: attachmentsError,
    refresh: refreshAttachments,
} = await useFetch<AttachmentsResponse>('/api/attachments', {
    query: attachmentQuery,
    lazy: true,
    default: () => ({ attachments: [], total: 0, page: 1, pageSize }),
});
const {
    data: kbRows,
    pending: kbsPending,
    error: kbsError,
    refresh: refreshKbs,
} = await useFetch<KbItem[]>('/api/settings/knowledge-bases', {
    query: computed(() => ({ spaceId: spaceFilter.value || undefined })),
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
const totalPages = computed(() => Math.max(1, Math.ceil((attachmentData.value?.total ?? 0) / pageSize)));

watch([keyword, spaceFilter], () => {
    page.value = 1;
});

watch(
    () => [route.query.tab, route.query.q, route.query.page, route.query.space] as const,
    ([nextTab, nextKeyword, nextPage, nextSpace]) => {
        const normalizedTab = queryTab(nextTab);
        const normalizedKeyword = queryText(nextKeyword);
        const normalizedPage = queryPage(nextPage);
        const normalizedSpace = queryText(nextSpace);
        if (tab.value !== normalizedTab) tab.value = normalizedTab;
        if (keyword.value !== normalizedKeyword) keyword.value = normalizedKeyword;
        if (page.value !== normalizedPage) page.value = normalizedPage;
        if (spaceFilter.value !== normalizedSpace) spaceFilter.value = normalizedSpace;
    },
);

watch([tab, keyword, page, spaceFilter], () => {
    const query = { ...route.query };
    if (tab.value === 'all') delete query.tab;
    else query.tab = tab.value;
    if (keyword.value.trim()) query.q = keyword.value.trim();
    else delete query.q;
    if (page.value > 1) query.page = String(page.value);
    else delete query.page;
    if (spaceFilter.value) query.space = spaceFilter.value;
    else delete query.space;
    void router.replace({ query });
});
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

async function uploadFile(event: Event) {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    uploading.value = true;
    uploadError.value = '';
    try {
        const form = new FormData();
        form.append('file', file);
        form.append('category', 'other');
        await $fetch('/api/attachments', { method: 'POST', body: form });
        page.value = 1;
        await refreshAttachments();
        await refreshKbs();
    } catch (e) {
        uploadError.value = extractApiError(e, t('library.uploadFailed'));
    } finally {
        uploading.value = false;
    }
}

async function removeFile(file: { id: string; filename: string }) {
    if (!confirm(t('library.deleteConfirm', { name: file.filename }))) return;
    uploadError.value = '';
    try {
        await $fetch(`/api/attachments/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
        if (attachments.value.length === 1 && page.value > 1) page.value -= 1;
        await refreshAttachments();
    } catch (e) {
        uploadError.value = extractApiError(e, t('library.deleteFailed'));
    }
}
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('library.title') }}</h1>
                <p class="app-page-subtitle">{{ t('library.subtitle') }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs" :disabled="uploading" @click="fileInput?.click()">
                    <AppIcon name="tray-arrow-up" :size="14" />
                    <span>{{ uploading ? t('library.uploading') : t('library.upload') }}</span>
                </button>
                <input ref="fileInput" type="file" class="hidden" @change="uploadFile" />
                <NuxtLink to="/chat" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs">
                    <AppIcon name="paperclip" :size="14" />
                    <span>{{ t('library.uploadFromChat') }}</span>
                </NuxtLink>
                <button type="button" class="app-btn app-btn-ghost !px-3 !py-1.5 !text-xs" @click="refreshAll">
                    <AppIcon name="autorenew" :size="14" />
                    <span>{{ t('common.retry') }}</span>
                </button>
            </div>
        </div>

        <div v-if="uploadError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ uploadError }}</span>
            <button type="button" class="app-btn app-btn-ghost !px-2 !py-1" @click="uploadError = ''">✕</button>
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
            <select v-model="spaceFilter" class="app-input !w-auto !text-xs" :aria-label="t('knowledge.allSpaces')">
                <option value="">{{ t('knowledge.allSpaces') }}</option>
                <option v-for="space in spaces" :key="space.id" :value="space.id">{{ space.icon }} {{ space.name }}</option>
            </select>
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
                    <div v-for="file in attachments" :key="file.id" class="app-card flex flex-col gap-3 p-4">
                        <a
                            :href="file.url || undefined"
                            target="_blank"
                            rel="noreferrer"
                            class="flex flex-col gap-3"
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
                            <div class="text-faint flex items-center justify-between gap-2 text-[10px]">
                                <span>{{ formatBytes(file.size) }}</span>
                                <span>{{ formatDateTime(file.createdAt) }}</span>
                            </div>
                        </a>
                        <button
                            type="button"
                            class="app-btn app-btn-ghost app-btn-sm self-start !px-2 !py-1 !text-[10px] !text-[color:var(--danger)]"
                            @click="removeFile(file)"
                        >
                            {{ t('common.delete') }}
                        </button>
                    </div>
                </div>
                <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 pt-2">
                    <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs" :disabled="page <= 1" @click="page--">←</button>
                    <span class="text-faint text-[11px]">{{ page }} / {{ totalPages }}</span>
                    <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs" :disabled="page >= totalPages" @click="page++">→</button>
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
                    <NuxtLink
                        v-for="kb in kbs"
                        :key="kb.id"
                        :to="`/settings/knowledge/${encodeURIComponent(kb.id)}`"
                        class="app-card app-card-hover flex flex-col gap-3 p-4"
                    >
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
