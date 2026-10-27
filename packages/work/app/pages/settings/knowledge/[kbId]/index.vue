<script setup lang="ts">
import { extractApiError, formatDateTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import type { KnowledgeBaseItem, KnowledgeDocumentItem, KnowledgeReindexJob, KnowledgeSearchHit } from '../../../../utils/knowledge';

definePageMeta({ layout: 'settings' });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { spaces } = useChatSidebar();
const kbId = computed(() => route.params.kbId as string);

const kb = ref<KnowledgeBaseItem | null>(null);
const docs = ref<KnowledgeDocumentItem[]>([]);
const loading = ref(true);
const pageError = ref('');
const actionMessage = ref('');
const actionError = ref('');

const editOpen = ref(false);
const saving = ref(false);
const editError = ref('');
const editForm = reactive({ name: '', description: '', spaceId: '', embeddingModel: '' });

const searchOpen = ref(false);
const searchQuery = ref('');
const searchHits = ref<KnowledgeSearchHit[]>([]);
const searching = ref(false);
const searchRan = ref(false);
const searchError = ref('');

const reindexJob = ref<KnowledgeReindexJob | null>(null);
const reindexing = computed(() => reindexJob.value?.status === 'running');
const reindexPercent = computed(() => {
    const job = reindexJob.value;
    if (!job || !job.total) return 0;
    return Math.min(100, Math.round((job.processed / job.total) * 100));
});
const docTotal = computed(() => kb.value?.documentCount ?? 0);
const chunkTotal = computed(() => kb.value?.chunkCount ?? 0);
let loadToken = 0;
let reindexTimer: ReturnType<typeof setTimeout> | null = null;

function stopReindexPoll() {
    if (reindexTimer) {
        clearTimeout(reindexTimer);
        reindexTimer = null;
    }
}

function scheduleReindexPoll() {
    if (reindexTimer) return;
    reindexTimer = setTimeout(() => {
        reindexTimer = null;
        void pollReindex();
    }, 1000);
}

async function finishReindex(job: KnowledgeReindexJob) {
    stopReindexPoll();
    if (job.status === 'failed') {
        actionMessage.value = '';
        actionError.value = t('adminForm.kbReindexFailed') + (job.lastError ? t('adminForm.kbReindexReason', { reason: job.lastError.slice(0, 160) }) : '');
    } else {
        actionError.value = '';
        actionMessage.value =
            t('adminForm.kbReindexDone', { updated: job.updated, total: job.total, failed: job.failed, provider: job.provider ?? '—' }) +
            (job.lastError ? t('adminForm.kbReindexReason', { reason: job.lastError.slice(0, 160) }) : '');
    }
    await load();
}

async function pollReindex() {
    const id = kbId.value;
    try {
        const res = await $fetch<{ job: KnowledgeReindexJob | null }>(`/api/settings/knowledge-bases/${encodeURIComponent(id)}/reindex`);
        if (id !== kbId.value) return;
        const wasRunning = reindexJob.value?.status === 'running';
        reindexJob.value = res.job;
        if (res.job?.status === 'running') {
            scheduleReindexPoll();
        } else if (wasRunning && res.job) {
            await finishReindex(res.job);
        }
    } catch {
        // 轮询失败不打断界面：下一轮再试，任务在服务端照跑
        if (id === kbId.value) scheduleReindexPoll();
    }
}

/** 页面首次进入/切换知识库时接上已有任务（刷新后仍能看到进度）。 */
async function refreshReindexJob() {
    const id = kbId.value;
    try {
        const res = await $fetch<{ job: KnowledgeReindexJob | null }>(`/api/settings/knowledge-bases/${encodeURIComponent(id)}/reindex`);
        if (id !== kbId.value) return;
        reindexJob.value = res.job;
        if (res.job?.status === 'running') scheduleReindexPoll();
    } catch {
        // 状态接口失败不影响知识库详情本身
    }
}

async function load() {
    const token = ++loadToken;
    const id = kbId.value;
    loading.value = true;
    pageError.value = '';
    try {
        const [detail, documentRows] = await Promise.all([
            $fetch<KnowledgeBaseItem>(`/api/settings/knowledge-bases/${encodeURIComponent(id)}`),
            $fetch<KnowledgeDocumentItem[]>(`/api/settings/knowledge-bases/${encodeURIComponent(id)}/documents`, { query: { limit: 5 } }),
        ]);
        if (token !== loadToken) return;
        kb.value = detail;
        docs.value = documentRows;
    } catch (e) {
        if (token !== loadToken) return;
        pageError.value = extractApiError(e, t('common.loadFailed'));
        kb.value = null;
        docs.value = [];
    } finally {
        if (token === loadToken) loading.value = false;
    }
}

onMounted(() => {
    void load();
    void refreshReindexJob();
});

onBeforeUnmount(stopReindexPoll);

watch(kbId, () => {
    stopReindexPoll();
    reindexJob.value = null;
    editOpen.value = false;
    searchOpen.value = false;
    searchQuery.value = '';
    searchHits.value = [];
    searchRan.value = false;
    searchError.value = '';
    actionMessage.value = '';
    actionError.value = '';
    void load();
    void refreshReindexJob();
});

function openEdit() {
    if (!kb.value) return;
    actionMessage.value = '';
    actionError.value = '';
    Object.assign(editForm, {
        name: kb.value.name,
        description: kb.value.description,
        spaceId: kb.value.spaceId ?? '',
        embeddingModel: kb.value.embeddingModel,
    });
    editError.value = '';
    editOpen.value = true;
}

async function saveEdit() {
    if (!kb.value || saving.value) return;
    actionMessage.value = '';
    actionError.value = '';
    if (!editForm.name.trim()) {
        editError.value = t('adminForm.requiredName');
        return;
    }
    saving.value = true;
    editError.value = '';
    try {
        await $fetch(`/api/settings/knowledge-bases/${encodeURIComponent(kb.value.id)}`, {
            method: 'PATCH',
            body: {
                name: editForm.name.trim(),
                description: editForm.description.trim(),
                spaceId: editForm.spaceId || null,
                embeddingModel: editForm.embeddingModel.trim() || 'text-embedding-3-small',
            },
        });
        editOpen.value = false;
        actionMessage.value = t('common.saved');
        await load();
    } catch (e) {
        editError.value = extractApiError(e, t('adminForm.saveFailed'));
    } finally {
        saving.value = false;
    }
}

async function reindex() {
    if (!kb.value || reindexing.value) return;
    if (!confirm(t('adminForm.kbReindexConfirm', { name: kb.value.name, chunks: chunkTotal.value }))) return;
    actionError.value = '';
    actionMessage.value = t('adminForm.kbReindexStarted');
    try {
        const res = await $fetch<{ started: boolean; job: KnowledgeReindexJob }>(`/api/settings/knowledge-bases/${encodeURIComponent(kb.value.id)}/reindex`, {
            method: 'POST',
        });
        reindexJob.value = res.job;
        scheduleReindexPoll();
    } catch (e) {
        // 409 表示服务端已有任务在跑：不要报错，接上它的进度就是用户想要的
        const remote = await $fetch<{ job: KnowledgeReindexJob | null }>(`/api/settings/knowledge-bases/${encodeURIComponent(kb.value.id)}/reindex`).catch(
            () => null,
        );
        if (remote?.job?.status === 'running') {
            reindexJob.value = remote.job;
            actionError.value = '';
            actionMessage.value = t('adminForm.kbReindexRunning');
            scheduleReindexPoll();
        } else {
            actionMessage.value = '';
            actionError.value = extractApiError(e, t('adminForm.kbReindexFailed'));
        }
    }
}

async function removeKb() {
    if (!kb.value || !confirm(t('adminForm.kbDeleteConfirm'))) return;
    actionMessage.value = '';
    actionError.value = '';
    try {
        await $fetch(`/api/settings/knowledge-bases/${encodeURIComponent(kb.value.id)}`, { method: 'DELETE' });
        await router.push('/settings/knowledge');
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}

async function runSearch() {
    if (!kb.value || searching.value) return;
    const q = searchQuery.value.trim();
    if (!q) return;
    searching.value = true;
    searchError.value = '';
    searchRan.value = true;
    try {
        const res = await $fetch<{ hits: KnowledgeSearchHit[] }>(`/api/settings/knowledge-bases/${encodeURIComponent(kb.value.id)}/search`, { query: { q } });
        searchHits.value = res.hits ?? [];
    } catch (e) {
        searchHits.value = [];
        searchError.value = extractApiError(e, t('common.error'));
    } finally {
        searching.value = false;
    }
}
</script>

<template>
    <div class="space-y-5">
        <NuxtLink to="/settings/knowledge" class="text-faint text-hover-strong inline-flex items-center gap-1 text-xs">
            <span>←</span>
            <span>{{ t('knowledge.backToList') }}</span>
        </NuxtLink>

        <div v-if="loading" class="space-y-3">
            <div class="app-skeleton h-28" />
            <div class="app-skeleton h-40" />
        </div>

        <div v-else-if="pageError || !kb" class="app-empty">
            <AppIcon name="alert-outline" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ t('knowledge.detailNotFound') }}</p>
            <NuxtLink to="/settings/knowledge" class="app-btn app-btn-outline mt-3">{{ t('knowledge.backToList') }}</NuxtLink>
        </div>

        <template v-else>
            <div class="app-page-header">
                <div class="min-w-0">
                    <h1 class="app-page-title text-strong flex flex-wrap items-center gap-2">
                        <span class="truncate">📚 {{ kb.name }}</span>
                        <span class="app-chip shrink-0 !px-1.5 !py-0 !text-[9px]" :class="kb.spaceName ? 'app-chip-brand' : ''">
                            {{ kb.spaceName || t('knowledge.global') }}
                        </span>
                    </h1>
                    <p class="app-page-subtitle">{{ kb.description || t('common.none') }}</p>
                    <p class="text-faint mt-1 text-[10px]">
                        <span v-if="kb.createdAt">{{ t('spaceDetail.createdAt') }} {{ formatDateTime(kb.createdAt) }}</span>
                        <span v-if="kb.updatedAt" class="ml-3">{{ t('spaceDetail.updatedAt') }} {{ formatDateTime(kb.updatedAt) }}</span>
                    </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <NuxtLink :to="`/settings/knowledge/${encodeURIComponent(kb.id)}/documents`" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs">
                        <AppIcon name="file-outline" :size="14" />
                        <span>{{ t('knowledge.manageDocuments') }}</span>
                    </NuxtLink>
                    <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs" @click="openEdit">{{ t('adminForm.edit') }}</button>
                    <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs" :disabled="reindexing" @click="reindex">
                        {{ reindexing ? t('adminForm.kbReindexing') : t('adminForm.kbReindex') }}
                    </button>
                    <button type="button" class="app-btn app-btn-ghost !px-3 !py-1.5 !text-xs !text-[color:var(--danger)]" @click="removeKb">
                        {{ t('common.delete') }}
                    </button>
                </div>
            </div>

            <div v-if="actionMessage" class="app-alert app-alert-success">{{ actionMessage }}</div>
            <div v-if="actionError" class="app-alert app-alert-danger">{{ actionError }}</div>

            <div v-if="reindexJob && reindexing" class="app-alert app-alert-info">
                <div class="flex items-center justify-between gap-2">
                    <span>{{
                        t('adminForm.kbReindexProgress', {
                            processed: reindexJob.processed,
                            total: reindexJob.total,
                            updated: reindexJob.updated,
                            failed: reindexJob.failed,
                        })
                    }}</span>
                    <span class="font-mono text-[10px]">{{ reindexPercent }}%</span>
                </div>
                <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-3)]">
                    <div class="h-full rounded-full bg-[color:var(--brand)] transition-[width] duration-500" :style="{ width: `${reindexPercent}%` }" />
                </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div class="app-card p-4">
                    <p class="text-faint text-[11px]">{{ t('adminForm.kbDocs') }}</p>
                    <p class="text-strong mt-1 text-2xl font-black">{{ docTotal }}</p>
                </div>
                <div class="app-card p-4">
                    <p class="text-faint text-[11px]">Chunks</p>
                    <p class="text-strong mt-1 text-2xl font-black">{{ chunkTotal }}</p>
                </div>
                <div class="app-card p-4">
                    <p class="text-faint text-[11px]">{{ t('adminForm.kbEmbeddingModel') }}</p>
                    <p class="text-strong mt-1 truncate font-mono text-xs font-bold">{{ kb.embeddingModel }}</p>
                </div>
                <div class="app-card p-4">
                    <p class="text-faint text-[11px]">{{ t('adminForm.provider') }}</p>
                    <p class="text-strong mt-1 truncate text-xs font-bold">{{ kb.providerName || t('adminForm.defaultProvider') }}</p>
                </div>
            </div>

            <section class="app-card overflow-hidden">
                <div class="border-line flex items-center justify-between border-b px-4 py-3">
                    <h2 class="text-sm font-black">{{ t('adminForm.kbDocs') }}</h2>
                    <NuxtLink :to="`/settings/knowledge/${encodeURIComponent(kb.id)}/documents`" class="text-hover-brand text-[11px] font-bold">{{
                        t('knowledge.manageDocuments')
                    }}</NuxtLink>
                </div>
                <div v-if="docs.length" class="divide-line divide-y">
                    <NuxtLink
                        v-for="doc in docs"
                        :key="doc.id"
                        :to="`/settings/knowledge/${encodeURIComponent(kb.id)}/documents`"
                        class="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--surface-3)]"
                    >
                        <AppIcon name="file-outline" :size="16" class="text-faint shrink-0" />
                        <span class="min-w-0 flex-1"
                            ><span class="text-strong block truncate text-xs font-bold">{{ doc.title }}</span
                            ><span class="text-faint mt-0.5 block text-[10px]"
                                >{{ t('adminForm.kbDocChunks', { n: doc.chunkCount }) }} · {{ formatDateTime(doc.createdAt) }}</span
                            ></span
                        >
                    </NuxtLink>
                </div>
                <div v-else class="app-empty py-8">
                    <p class="app-empty-desc">{{ t('adminForm.kbDocEmpty') }}</p>
                </div>
            </section>

            <section class="app-card overflow-hidden">
                <button type="button" class="flex w-full items-center justify-between px-4 py-3 text-left" @click="searchOpen = !searchOpen">
                    <span class="text-sm font-black">{{ t('adminForm.kbSearchTitle') }}</span
                    ><span class="text-faint text-[11px]">{{ searchOpen ? '−' : '+' }}</span>
                </button>
                <div v-if="searchOpen" class="border-line space-y-3 border-t px-4 py-3">
                    <div class="flex items-center gap-2">
                        <input
                            v-model="searchQuery"
                            class="app-input !text-xs"
                            :placeholder="t('adminForm.kbSearchPlaceholder')"
                            @keydown.enter.prevent="runSearch"
                        />
                        <button type="button" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs" :disabled="searching" @click="runSearch">
                            {{ t('adminForm.kbSearchRun') }}
                        </button>
                    </div>
                    <p v-if="searchError" class="app-help-error">{{ searchError }}</p>
                    <div v-if="searchHits.length" class="space-y-2">
                        <div v-for="(hit, index) in searchHits" :key="index" class="app-card p-3">
                            <span class="app-badge app-badge-info !text-[9px]">{{ t('adminForm.kbSearchScore', { score: hit.score.toFixed(2) }) }}</span>
                            <p class="text-soft mt-1 text-xs whitespace-pre-wrap">{{ hit.content }}</p>
                        </div>
                    </div>
                    <p v-else-if="searchRan && !searching" class="text-faint text-center text-xs">{{ t('adminForm.kbSearchEmpty') }}</p>
                </div>
            </section>
        </template>

        <AdminDrawer :open="editOpen" :title="t('adminForm.kbEditTitle')" width-class="sm:max-w-xl" @close="editOpen = false">
            <div class="space-y-3">
                <input
                    v-model="editForm.name"
                    class="app-input"
                    maxlength="100"
                    :placeholder="t('adminForm.kbNamePlaceholder')"
                    :aria-label="t('adminForm.kbNamePlaceholder')"
                />
                <input
                    v-model="editForm.description"
                    class="app-input"
                    maxlength="500"
                    :placeholder="t('adminForm.description')"
                    :aria-label="t('adminForm.description')"
                />
                <select v-model="editForm.spaceId" class="app-input" :aria-label="t('adminForm.kbSpace')">
                    <option value="">{{ t('adminForm.kbGlobalSpace') }}</option>
                    <option v-for="space in spaces" :key="space.id" :value="space.id">{{ space.icon }} {{ space.name }}</option>
                </select>
                <input
                    v-model="editForm.embeddingModel"
                    class="app-input !font-mono !text-xs"
                    :placeholder="t('adminForm.kbEmbeddingModel')"
                    :aria-label="t('adminForm.kbEmbeddingModel')"
                />
                <p v-if="editError" class="app-help-error">{{ editError }}</p>
            </div>
            <template #footer>
                <div class="flex w-full items-center justify-end gap-2">
                    <button type="button" class="app-btn app-btn-ghost" :disabled="saving" @click="editOpen = false">{{ t('adminForm.cancel') }}</button>
                    <button type="button" class="app-btn app-btn-primary" :disabled="saving" @click="saveEdit">{{ t('adminForm.save') }}</button>
                </div>
            </template>
        </AdminDrawer>
    </div>
</template>
