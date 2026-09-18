<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

interface KbItem {
    id: string;
    name: string;
    description: string;
    embeddingModel: string;
    providerName?: string | null;
    documentCount: number;
    chunkCount: number;
}
interface DocItem {
    id: string;
    title: string;
    chunkCount: number;
    createdAt: string;
}
interface HitItem {
    score: number;
    content: string;
}

const kbs = ref<KbItem[]>([]);
const current = ref<KbItem | null>(null);
const docs = ref<DocItem[]>([]);
const message = ref('');
/** 列表级错误（与操作提示 message 分开，避免互相覆盖） */
const listError = ref('');

const newKb = reactive({ name: '', description: '', embeddingModel: 'text-embedding-3-small' });
/** 编辑中的知识库（后端支持 PATCH，此前没有入口，写错名字只能删库重建） */
const editingKb = ref<KbItem | null>(null);
const editForm = reactive({ name: '', description: '', embeddingModel: '' });
const docForm = reactive({ title: '', content: '' });
const searchQuery = ref('');
const searchHits = ref<HitItem[]>([]);
const uploading = ref(false);
const fileRef = ref<HTMLInputElement | null>(null);
const reindexing = ref(false);

/** 重建向量索引：修复嵌入接口故障期间入库的空向量分块 */
async function reindex(kb: KbItem) {
    if (!confirm(t('adminForm.kbReindexConfirm', { name: kb.name, chunks: kb.chunkCount }))) return;
    reindexing.value = true;
    message.value = t('adminForm.kbReindexing');
    try {
        const res = await $fetch<{
            ok: boolean;
            updated: number;
            failed: number;
            total: number;
            lastError?: string | null;
            knowledgeBase: { provider: string };
        }>(`/api/admin/knowledge-bases/${kb.id}/reindex`, { method: 'POST' });
        message.value =
            t('adminForm.kbReindexDone', {
                updated: res.updated,
                total: res.total,
                failed: res.failed,
                provider: res.knowledgeBase.provider,
            }) + (res.lastError ? ` · ${t('adminForm.kbReindexReason')}：${res.lastError.slice(0, 160)}` : '');
    } catch (e) {
        message.value = extractApiError(e, t('adminForm.kbReindexFailed'));
    } finally {
        reindexing.value = false;
        await load();
    }
}

async function load() {
    try {
        kbs.value = await $fetch<KbItem[]>('/api/admin/knowledge-bases');
        listError.value = '';
    } catch (e) {
        // 失败时清空并提示：否则表格走空态，会被读成「还没有知识库」
        kbs.value = [];
        listError.value = extractApiError(e, t('adminForm.loadFailed'));
    }
}

onMounted(load);

async function createKb() {
    if (!newKb.name.trim()) {
        message.value = t('adminForm.requiredName');
        return;
    }
    message.value = '';
    try {
        await $fetch('/api/admin/knowledge-bases', { method: 'POST', body: { ...newKb } });
        Object.assign(newKb, { name: '', description: '', embeddingModel: 'text-embedding-3-small' });
        await load();
    } catch (e) {
        message.value = extractApiError(e, t('adminForm.saveFailed'));
    }
}

async function open(kb: KbItem) {
    current.value = kb;
    searchHits.value = [];
    message.value = '';
    try {
        docs.value = await $fetch(`/api/admin/knowledge-bases/${kb.id}/documents`);
    } catch (e) {
        docs.value = [];
        message.value = extractApiError(e, t('adminForm.loadFailed'));
    }
}

/** 打开编辑：改名 / 描述 / embedding 模型（服务端 PATCH 已支持） */
function openEditKb(kb: KbItem) {
    editingKb.value = kb;
    Object.assign(editForm, { name: kb.name, description: kb.description, embeddingModel: kb.embeddingModel });
    listError.value = '';
}

async function saveKb() {
    if (!editingKb.value) return;
    if (!editForm.name.trim()) {
        listError.value = t('adminForm.requiredName');
        return;
    }
    listError.value = '';
    try {
        const updated = await $fetch<KbItem>(`/api/admin/knowledge-bases/${editingKb.value.id}`, {
            method: 'PATCH',
            body: { name: editForm.name, description: editForm.description, embeddingModel: editForm.embeddingModel },
        });
        // 同步当前面板标题，避免改名后仍显示旧名
        if (current.value?.id === updated.id) current.value = { ...current.value, ...updated };
        editingKb.value = null;
        await load();
    } catch (e) {
        listError.value = extractApiError(e, t('adminForm.saveFailed'));
    }
}

async function removeKb(id: string) {
    if (!confirm(t('adminForm.kbDeleteConfirm'))) return;
    message.value = '';
    try {
        await $fetch(`/api/admin/knowledge-bases/${id}`, { method: 'DELETE' });
        if (current.value?.id === id) {
            current.value = null;
            docs.value = [];
        }
        await load();
    } catch (e) {
        message.value = extractApiError(e, t('adminForm.deleteFailed'));
    }
}

async function addDoc() {
    if (!current.value) return;
    const file = fileRef.value?.files?.[0];
    uploading.value = true;
    message.value = '';
    try {
        if (file) {
            const form = new FormData();
            form.append('file', file);
            if (docForm.title) form.append('title', docForm.title);
            await $fetch(`/api/admin/knowledge-bases/${current.value.id}/documents`, {
                method: 'POST',
                body: form,
            });
        } else {
            if (!docForm.content.trim()) {
                message.value = t('adminForm.kbDocNeedContent');
                return;
            }
            await $fetch(`/api/admin/knowledge-bases/${current.value.id}/documents`, {
                method: 'POST',
                body: { title: docForm.title || undefined, content: docForm.content },
            });
        }
        message.value = t('adminForm.kbDocImported');
        docForm.title = '';
        docForm.content = '';
        if (fileRef.value) fileRef.value.value = '';
        docs.value = await $fetch(`/api/admin/knowledge-bases/${current.value.id}/documents`);
        await load();
    } catch (error) {
        message.value = extractApiError(error, t('adminForm.kbDocImportFailed'));
    } finally {
        uploading.value = false;
    }
}

async function removeDoc(id: string) {
    if (!current.value || !confirm(t('adminForm.kbDocDeleteConfirm'))) return;
    await $fetch(`/api/admin/knowledge-bases/${current.value.id}/documents/${id}`, { method: 'DELETE' });
    docs.value = await $fetch(`/api/admin/knowledge-bases/${current.value.id}/documents`);
    await load();
}

async function search() {
    if (!current.value || !searchQuery.value.trim()) return;
    message.value = '';
    try {
        const res = await $fetch<{ hits: HitItem[] }>(`/api/admin/knowledge-bases/${current.value.id}/search`, {
            query: { q: searchQuery.value },
        });
        searchHits.value = res.hits;
    } catch (e) {
        searchHits.value = [];
        message.value = extractApiError(e, t('adminForm.operationFailed'));
    }
}
</script>

<template>
    <div class="flex gap-6">
        <div class="w-1/2">
            <h1 class="mb-2 text-2xl font-bold text-gray-800">{{ t('adminForm.kbTitle') }}</h1>
            <p class="mb-4 text-xs text-gray-400">{{ t('adminForm.kbSubtitle') }}</p>

            <div v-if="listError" class="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
                {{ listError }}
                <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
            </div>

            <!-- 编辑知识库：改名/描述/embedding 模型（此前只能删库重建） -->
            <div v-if="editingKb" class="mb-4 space-y-2 rounded-2xl bg-white p-4 shadow-sm">
                <p class="text-xs font-bold text-gray-600">{{ t('adminForm.kbEditTitle') }}</p>
                <div class="flex gap-2">
                    <input
                        v-model="editForm.name"
                        :placeholder="t('adminForm.kbNamePlaceholder')"
                        class="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <input
                        v-model="editForm.description"
                        :placeholder="t('adminForm.description')"
                        class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <input
                        v-model="editForm.embeddingModel"
                        :placeholder="t('adminForm.kbEmbeddingModel')"
                        class="w-52 rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    />
                </div>
                <div class="flex gap-2">
                    <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="saveKb">
                        {{ t('adminForm.save') }}
                    </button>
                    <button class="rounded-lg bg-gray-100 px-4 py-1.5 text-sm" @click="editingKb = null">{{ t('adminForm.cancel') }}</button>
                </div>
            </div>

            <div class="mb-4 flex gap-2 rounded-2xl bg-white p-4 shadow-sm">
                <input v-model="newKb.name" :placeholder="t('adminForm.kbNamePlaceholder')" class="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input
                    v-model="newKb.description"
                    :placeholder="t('adminForm.description')"
                    class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                    v-model="newKb.embeddingModel"
                    :placeholder="t('adminForm.kbEmbeddingModel')"
                    class="w-52 rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                />
                <button class="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700" @click="createKb">
                    {{ t('adminForm.kbCreate') }}
                </button>
            </div>

            <table class="w-full rounded-2xl bg-white text-sm shadow-sm">
                <thead class="text-left text-gray-400">
                    <tr>
                        <th class="p-4">{{ t('adminForm.kbColName') }}</th>
                        <th class="p-4">{{ t('adminForm.kbColCounts') }}</th>
                        <th class="p-4">{{ t('adminForm.actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="kb in kbs" :key="kb.id" class="border-t border-gray-100">
                        <td class="p-4">
                            <p class="font-medium text-gray-800">{{ kb.name }}</p>
                            <p class="text-xs text-gray-400">
                                {{ kb.description }} · {{ kb.providerName || t('adminForm.defaultProvider') }} / {{ kb.embeddingModel }}
                            </p>
                        </td>
                        <td class="p-4 text-gray-500">{{ kb.documentCount }} / {{ kb.chunkCount }}</td>
                        <td class="space-x-2 p-4">
                            <button class="text-green-600 hover:underline" @click="open(kb)">{{ t('adminForm.kbManage') }}</button>
                            <button class="text-blue-600 hover:underline" @click="openEditKb(kb)">{{ t('adminForm.edit') }}</button>
                            <button class="text-blue-600 hover:underline disabled:opacity-50" :disabled="reindexing" @click="reindex(kb)">
                                {{ t('adminForm.kbReindex') }}
                            </button>
                            <button class="text-red-500 hover:underline" @click="removeKb(kb.id)">{{ t('adminForm.delete') }}</button>
                        </td>
                    </tr>
                    <tr v-if="!kbs.length">
                        <td colspan="3" class="p-8 text-center text-gray-400">{{ t('adminForm.kbEmpty') }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div v-if="current" class="w-1/2 space-y-4">
            <div class="rounded-2xl bg-white p-6 shadow-sm">
                <div class="mb-3 flex items-center justify-between">
                    <h2 class="font-bold text-gray-800">{{ current.name }} · {{ t('adminForm.kbDocs') }}</h2>
                    <button class="text-sm text-gray-400 hover:text-gray-600" @click="current = null">{{ t('adminForm.kbClose') }}</button>
                </div>
                <div class="space-y-2">
                    <input
                        v-model="docForm.title"
                        :placeholder="t('adminForm.kbDocTitlePlaceholder')"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <input ref="fileRef" type="file" accept=".txt,.md,.markdown,.csv,.json" class="block w-full text-xs text-gray-500" />
                    <textarea
                        v-model="docForm.content"
                        rows="4"
                        :placeholder="t('adminForm.kbDocContentPlaceholder')"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <button
                        :disabled="uploading"
                        class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                        @click="addDoc"
                    >
                        {{ uploading ? t('adminForm.kbDocImporting') : t('adminForm.kbDocImport') }}
                    </button>
                    <p v-if="message" class="text-xs text-gray-500">{{ message }}</p>
                </div>
                <ul class="mt-4 space-y-1">
                    <li v-for="d in docs" :key="d.id" class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                        <span class="truncate text-gray-700"
                            >{{ d.title }} <span class="text-xs text-gray-400">{{ t('adminForm.kbDocChunks', { n: d.chunkCount }) }}</span></span
                        >
                        <button class="text-xs text-red-400 hover:text-red-500" @click="removeDoc(d.id)">{{ t('adminForm.delete') }}</button>
                    </li>
                    <li v-if="!docs.length" class="py-4 text-center text-sm text-gray-400">{{ t('adminForm.kbDocEmpty') }}</li>
                </ul>
            </div>

            <div class="rounded-2xl bg-white p-6 shadow-sm">
                <h3 class="mb-2 text-sm font-bold text-gray-800">{{ t('adminForm.kbSearchTitle') }}</h3>
                <div class="flex gap-2">
                    <input
                        v-model="searchQuery"
                        :placeholder="t('adminForm.kbSearchPlaceholder')"
                        class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        @keyup.enter="search"
                    />
                    <button class="rounded-lg bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200" @click="search">
                        {{ t('adminForm.kbSearchRun') }}
                    </button>
                </div>
                <div class="mt-3 max-h-64 space-y-2 overflow-y-auto">
                    <div v-for="(hit, i) in searchHits" :key="i" class="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                        <p class="mb-1 font-semibold text-gray-500">{{ t('adminForm.kbSearchScore', { score: hit.score.toFixed(3) }) }}</p>
                        <p class="whitespace-pre-wrap">{{ hit.content }}</p>
                    </div>
                    <p v-if="searchQuery && !searchHits.length" class="text-center text-sm text-gray-400">{{ t('adminForm.kbSearchEmpty') }}</p>
                </div>
            </div>
        </div>
    </div>
</template>
