<script setup lang="ts">
import { extractApiError, formatDateTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import type { KnowledgeBaseItem, KnowledgeDocumentItem } from '../../../../utils/knowledge';

definePageMeta({ layout: 'settings' });

const { t } = useI18n();
const route = useRoute();
const kbId = computed(() => route.params.kbId as string);

const kb = ref<KnowledgeBaseItem | null>(null);
const docs = ref<KnowledgeDocumentItem[]>([]);
const loading = ref(true);
const listError = ref('');
const uploading = ref(false);
const actionError = ref('');
const success = ref('');
const fileRef = ref<HTMLInputElement | null>(null);
const form = reactive({ title: '', content: '' });

async function load() {
    loading.value = true;
    listError.value = '';
    try {
        const [detail, rows] = await Promise.all([
            $fetch<KnowledgeBaseItem>(`/api/settings/knowledge-bases/${encodeURIComponent(kbId.value)}`),
            $fetch<KnowledgeDocumentItem[]>(`/api/settings/knowledge-bases/${encodeURIComponent(kbId.value)}/documents`, { query: { limit: 500 } }),
        ]);
        kb.value = detail;
        docs.value = rows;
    } catch (e) {
        listError.value = extractApiError(e, t('common.loadFailed'));
        kb.value = null;
        docs.value = [];
    } finally {
        loading.value = false;
    }
}

onMounted(load);

async function importDocument() {
    if (uploading.value) return;
    const file = fileRef.value?.files?.[0];
    if (!file && !form.content.trim()) {
        actionError.value = t('adminForm.kbDocNeedContent');
        return;
    }
    uploading.value = true;
    actionError.value = '';
    success.value = '';
    try {
        if (file) {
            const body = new FormData();
            body.append('file', file);
            if (form.title.trim()) body.append('title', form.title.trim());
            await $fetch(`/api/settings/knowledge-bases/${encodeURIComponent(kbId.value)}/documents`, { method: 'POST', body });
        } else {
            await $fetch(`/api/settings/knowledge-bases/${encodeURIComponent(kbId.value)}/documents`, {
                method: 'POST',
                body: { title: form.title.trim() || undefined, content: form.content },
            });
        }
        form.title = '';
        form.content = '';
        if (fileRef.value) fileRef.value.value = '';
        success.value = t('adminForm.kbDocImported');
        await load();
    } catch (e) {
        actionError.value = extractApiError(e, t('adminForm.kbDocImportFailed'));
    } finally {
        uploading.value = false;
    }
}

async function removeDocument(doc: KnowledgeDocumentItem) {
    if (!confirm(t('adminForm.kbDocDeleteConfirm'))) return;
    actionError.value = '';
    try {
        await $fetch(`/api/settings/knowledge-bases/${encodeURIComponent(kbId.value)}/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
        success.value = t('common.deleted');
        await load();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}
</script>

<template>
    <div class="space-y-5">
        <div class="flex flex-wrap items-center gap-3">
            <NuxtLink :to="`/settings/knowledge/${encodeURIComponent(kbId)}`" class="text-faint text-hover-strong inline-flex items-center gap-1 text-xs">
                <span>←</span><span>{{ t('knowledge.backToDetail') }}</span>
            </NuxtLink>
            <NuxtLink to="/settings/knowledge" class="text-faint text-hover-strong text-xs">{{ t('knowledge.backToList') }}</NuxtLink>
        </div>

        <div v-if="loading" class="space-y-3">
            <div class="app-skeleton h-24" />
            <div class="app-skeleton h-40" />
        </div>

        <div v-else-if="listError || !kb" class="app-empty">
            <AppIcon name="alert-outline" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ t('knowledge.detailNotFound') }}</p>
        </div>

        <template v-else>
            <div class="app-page-header">
                <div>
                    <h1 class="app-page-title text-strong truncate">{{ kb.name }} · {{ t('adminForm.kbDocs') }}</h1>
                    <p class="app-page-subtitle">{{ t('knowledge.documentsSubtitle') }}</p>
                </div>
                <span class="app-chip">{{ t('library.documents', { n: kb.documentCount }) }}</span>
            </div>

            <div v-if="actionError" class="app-alert app-alert-danger">{{ actionError }}</div>
            <div v-if="success" class="app-alert app-alert-success">{{ success }}</div>

            <section class="app-card space-y-3 p-4">
                <h2 class="text-sm font-black">{{ t('adminForm.kbDocImport') }}</h2>
                <input v-model="form.title" class="app-input" maxlength="200" :placeholder="t('adminForm.kbDocTitlePlaceholder')" :aria-label="t('adminForm.kbDocTitlePlaceholder')" />
                <textarea v-model="form.content" rows="5" class="app-input" :placeholder="t('adminForm.kbDocContentPlaceholder')" :aria-label="t('adminForm.kbDocContentLabel')" />
                <div class="flex flex-wrap items-center gap-3">
                    <input ref="fileRef" type="file" accept=".txt,.md,.markdown,.csv,.json" class="text-muted-2 block text-xs" :aria-label="t('adminForm.kbDocFileLabel')" />
                    <button type="button" class="app-btn app-btn-primary !px-3 !py-1.5 !text-xs" :disabled="uploading" @click="importDocument">
                        <AppIcon name="tray-arrow-up" :size="14" />
                        <span>{{ uploading ? t('adminForm.kbDocImporting') : t('adminForm.kbDocImport') }}</span>
                    </button>
                </div>
            </section>

            <section class="app-card overflow-hidden">
                <div class="border-line flex items-center justify-between border-b px-4 py-3">
                    <h2 class="text-sm font-black">{{ t('adminForm.kbDocs') }}</h2>
                    <span class="text-faint text-[11px]">{{ docs.length }}</span>
                </div>
                <div v-if="docs.length" class="divide-line divide-y">
                    <div v-for="doc in docs" :key="doc.id" class="flex items-center gap-3 px-4 py-3">
                        <AppIcon name="file-outline" :size="16" class="text-faint shrink-0" />
                        <div class="min-w-0 flex-1">
                            <p class="text-strong truncate text-xs font-bold">{{ doc.title }}</p>
                            <p class="text-faint mt-0.5 text-[10px]">{{ t('adminForm.kbDocChunks', { n: doc.chunkCount }) }} · {{ formatDateTime(doc.createdAt) }}</p>
                        </div>
                        <span class="app-badge app-badge-neutral !text-[9px]">{{ doc.status }}</span>
                        <button type="button" class="app-btn app-btn-ghost app-btn-icon !text-[color:var(--danger)]" :title="t('common.delete')" :aria-label="t('common.delete')" @click="removeDocument(doc)">
                            <AppIcon name="trash-can-outline" :size="15" />
                        </button>
                    </div>
                </div>
                <div v-else class="app-empty py-10">
                    <AppIcon name="file-outline" :size="28" class="app-empty-icon" />
                    <p class="app-empty-title">{{ t('adminForm.kbDocEmpty') }}</p>
                </div>
            </section>
        </template>
    </div>
</template>
