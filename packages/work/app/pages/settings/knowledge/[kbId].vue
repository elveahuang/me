<script setup lang="ts">
import { extractApiError, formatDateTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import type { KnowledgeBaseItem, KnowledgeDocumentItem, KnowledgeSearchHit } from '../../../utils/knowledge';

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

const reindexing = ref(false);
const docTotal = computed(() => kb.value?.documentCount ?? 0);
const chunkTotal = computed(() => kb.value?.chunkCount ?? 0);

async function load() {
    loading.value = true;
    pageError.value = '';
    try {
        const [detail, documentRows] = await Promise.all([
            $fetch<KnowledgeBaseItem>(`/api/settings/knowledge-bases/${encodeURIComponent(kbId.value)}`),
            $fetch<KnowledgeDocumentItem[]>(`/api/settings/knowledge-bases/${encodeURIComponent(kbId.value)}/documents`, { query: { limit: 5 } }),
        ]);
        kb.value = detail;
        docs.value = documentRows;
    } catch (e) {
        pageError.value = extractApiError(e, t('common.loadFailed'));
        kb.value = null;
        docs.value = [];
    } finally {
        loading.value = false;
    }
}

onMounted(load);

function openEdit() {
    if (!kb.value) return;
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
                spaceId: editForm.spaceId || undefined,
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
    reindexing.value = true;
    actionError.value = '';
    actionMessage.value = t('adminForm.kbReindexing');
    try {
        const res = await $fetch<{ updated: number; failed: number; total: number; lastError?: string | null; knowledgeBase: { provider: string } }>(
            `/api/settings/knowledge-bases/${encodeURIComponent(kb.value.id)}/reindex`,
            { method: 'POST' },
        );
        actionMessage.value =
            t('adminForm.kbReindexDone', { updated: res.updated, total: res.total, failed: res.failed, provider: res.knowledgeBase.provider }) +
            (res.lastError ? t('adminForm.kbReindexReason', { reason: res.lastError.slice(0, 160) }) : '');
        await load();
    } catch (e) {
        actionError.value = extractApiError(e, t('adminForm.kbReindexFailed'));
    } finally {
        reindexing.value = false;
    }
}

async function removeKb() {
    if (!kb.value || !confirm(t('adminForm.kbDeleteConfirm'))) return;
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
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <NuxtLink :to="`/settings/knowledge/${encodeURIComponent(kb.id)}/documents`" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs">
                        <AppIcon name="file-outline" :size="14" />
                        <span>{{ t('knowledge.manageDocuments') }}</span>
                    </NuxtLink>
                    <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs" @click="openEdit">{{ t('adminForm.edit') }}</button>
                    <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs" :disabled="reindexing" @click="reindex">{{ t('adminForm.kbReindex') }}</button>
                    <button type="button" class="app-btn app-btn-ghost !px-3 !py-1.5 !text-xs !text-[color:var(--danger)]" @click="removeKb">{{ t('common.delete') }}</button>
                </div>
            </div>

            <div v-if="actionMessage" class="app-alert app-alert-success">{{ actionMessage }}</div>
            <div v-if="actionError" class="app-alert app-alert-danger">{{ actionError }}</div>

            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div class="app-card p-4"><p class="text-faint text-[11px]">{{ t('adminForm.kbDocs') }}</p><p class="text-strong mt-1 text-2xl font-black">{{ docTotal }}</p></div>
                <div class="app-card p-4"><p class="text-faint text-[11px]">Chunks</p><p class="text-strong mt-1 text-2xl font-black">{{ chunkTotal }}</p></div>
                <div class="app-card p-4"><p class="text-faint text-[11px]">{{ t('adminForm.kbEmbeddingModel') }}</p><p class="text-strong mt-1 truncate font-mono text-xs font-bold">{{ kb.embeddingModel }}</p></div>
                <div class="app-card p-4"><p class="text-faint text-[11px]">{{ t('adminForm.provider') }}</p><p class="text-strong mt-1 truncate text-xs font-bold">{{ kb.providerName || t('adminForm.defaultProvider') }}</p></div>
            </div>

            <section class="app-card overflow-hidden">
                <div class="border-line flex items-center justify-between border-b px-4 py-3">
                    <h2 class="text-sm font-black">{{ t('adminForm.kbDocs') }}</h2>
                    <NuxtLink :to="`/settings/knowledge/${encodeURIComponent(kb.id)}/documents`" class="text-hover-brand text-[11px] font-bold">{{ t('knowledge.manageDocuments') }}</NuxtLink>
                </div>
                <div v-if="docs.length" class="divide-line divide-y">
                    <NuxtLink v-for="doc in docs" :key="doc.id" :to="`/settings/knowledge/${encodeURIComponent(kb.id)}/documents`" class="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--surface-3)]">
                        <AppIcon name="file-outline" :size="16" class="text-faint shrink-0" />
                        <span class="min-w-0 flex-1"><span class="text-strong block truncate text-xs font-bold">{{ doc.title }}</span><span class="text-faint mt-0.5 block text-[10px]">{{ t('adminForm.kbDocChunks', { n: doc.chunkCount }) }} · {{ formatDateTime(doc.createdAt) }}</span></span>
                    </NuxtLink>
                </div>
                <div v-else class="app-empty py-8"><p class="app-empty-desc">{{ t('adminForm.kbDocEmpty') }}</p></div>
            </section>

            <section class="app-card overflow-hidden">
                <button type="button" class="flex w-full items-center justify-between px-4 py-3 text-left" @click="searchOpen = !searchOpen">
                    <span class="text-sm font-black">{{ t('adminForm.kbSearchTitle') }}</span><span class="text-faint text-[11px]">{{ searchOpen ? '−' : '+' }}</span>
                </button>
                <div v-if="searchOpen" class="border-line space-y-3 border-t px-4 py-3">
                    <div class="flex items-center gap-2">
                        <input v-model="searchQuery" class="app-input !text-xs" :placeholder="t('adminForm.kbSearchPlaceholder')" @keydown.enter.prevent="runSearch" />
                        <button type="button" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs" :disabled="searching" @click="runSearch">{{ t('adminForm.kbSearchRun') }}</button>
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
                <input v-model="editForm.name" class="app-input" maxlength="100" :placeholder="t('adminForm.kbNamePlaceholder')" :aria-label="t('adminForm.kbNamePlaceholder')" />
                <input v-model="editForm.description" class="app-input" maxlength="500" :placeholder="t('adminForm.description')" :aria-label="t('adminForm.description')" />
                <select v-model="editForm.spaceId" class="app-input" :aria-label="t('adminForm.kbSpace')">
                    <option value="">{{ t('adminForm.kbGlobalSpace') }}</option>
                    <option v-for="space in spaces" :key="space.id" :value="space.id">{{ space.icon }} {{ space.name }}</option>
                </select>
                <input v-model="editForm.embeddingModel" class="app-input !font-mono !text-xs" :placeholder="t('adminForm.kbEmbeddingModel')" :aria-label="t('adminForm.kbEmbeddingModel')" />
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
