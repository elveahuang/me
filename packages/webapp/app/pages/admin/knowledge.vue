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
const loading = ref(true); // 首帧即加载态：数据要等挂载后的请求，初值 false 会让「暂无…」空态先闪一帧，SSR 首屏更是直接把空态发给用户
/** 右侧文档列表同理：open() 后要等 documents 请求返回，期间不能把「暂无文档」当空态显示 */
const docsLoading = ref(false);

const newKb = reactive({ name: '', description: '', embeddingModel: 'text-embedding-3-small' });
/** 新建知识库抽屉开关 */
const createOpen = ref(false);
const createError = ref('');
/** 编辑中的知识库（后端支持 PATCH，此前没有入口，写错名字只能删库重建） */
const editingKb = ref<KbItem | null>(null);
const editError = ref('');
const editForm = reactive({ name: '', description: '', embeddingModel: '' });
const docForm = reactive({ title: '', content: '' });
const searchQuery = ref('');
const searchHits = ref<HitItem[]>([]);
const uploading = ref(false);
/** 新建/编辑知识库的提交中标记：原本没有 disabled，双击会建出两条同名知识库 */
const creatingKb = ref(false);
const savingKb = ref(false);
const fileRef = ref<HTMLInputElement | null>(null);
const reindexing = ref(false);

/** 重建向量索引：修复嵌入接口故障期间入库的空向量分块 */
async function reindex(kb: KbItem) {
    if (reindexing.value) return;
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
        }>(`/api/admin/knowledge-bases/${encodeURIComponent(kb.id)}/reindex`, { method: 'POST' });
        message.value =
            t('adminForm.kbReindexDone', {
                updated: res.updated,
                total: res.total,
                failed: res.failed,
                provider: res.knowledgeBase.provider,
            }) + (res.lastError ? t('adminForm.kbReindexReason', { reason: res.lastError.slice(0, 160) }) : '');
    } catch (e) {
        message.value = extractApiError(e, t('adminForm.kbReindexFailed'));
    } finally {
        reindexing.value = false;
        await load();
    }
}

async function load() {
    loading.value = true;
    try {
        kbs.value = await $fetch<KbItem[]>('/api/admin/knowledge-bases');
        listError.value = '';
    } catch (e) {
        // 失败时清空并提示：否则表格走空态，会被读成「还没有知识库」
        kbs.value = [];
        listError.value = extractApiError(e, t('adminForm.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

/** 打开新建抽屉：清空上次输入与错误 */
function openCreateKb() {
    Object.assign(newKb, { name: '', description: '', embeddingModel: 'text-embedding-3-small' });
    createError.value = '';
    createOpen.value = true;
}

async function createKb() {
    if (creatingKb.value) return;
    createError.value = '';
    if (!newKb.name.trim()) {
        createError.value = t('adminForm.requiredName');
        return;
    }
    creatingKb.value = true;
    try {
        await $fetch('/api/admin/knowledge-bases', { method: 'POST', body: { ...newKb } });
        Object.assign(newKb, { name: '', description: '', embeddingModel: 'text-embedding-3-small' });
        createOpen.value = false;
        await load();
    } catch (e) {
        createError.value = extractApiError(e, t('adminForm.saveFailed'));
    } finally {
        creatingKb.value = false;
    }
}

/** 文档面板请求序号：快速切换知识库时，只允许最新一次的响应写入列表 */
let docsToken = 0;
/** 检索请求序号：与 docsToken 分开（否则会取消在途的文档加载），切换知识库时一并作废旧检索 */
let searchToken = 0;

async function open(kb: KbItem) {
    docsToken++;
    searchToken++;
    current.value = kb;
    searchHits.value = [];
    message.value = '';
    // 先清空：否则请求失败或返回慢时，界面上会挂着上一条知识库的文档
    docs.value = [];
    await reloadDocs(kb.id);
}

/**
 * 文档列表的唯一写入口。
 *
 * 「面板停在哪个知识库」由 current 与 docsToken 一起决定，而导入一条文档要等嵌入接口跑完
 * （服务端预算 300 秒），期间完全可以点开另一条知识库——open() 已把面板清空成「B 加载中」。
 * 少了这道比对时，A 的刷新响应会直接写进 B 的面板：标题是 B、列出来的是 A 的文档，
 * 于是「删除」按钮上的 id 与当前库完全对不上。
 */
async function reloadDocs(kbId: string) {
    const token = docsToken;
    docsLoading.value = true;
    try {
        const rows = await $fetch<DocItem[]>(`/api/admin/knowledge-bases/${encodeURIComponent(kbId)}/documents`);
        if (token !== docsToken || current.value?.id !== kbId) return;
        docs.value = rows;
    } catch (e) {
        if (token !== docsToken || current.value?.id !== kbId) return;
        message.value = extractApiError(e, t('adminForm.loadFailed'));
    } finally {
        // 只有最新一次请求可以收尾：迟到的旧响应不能把新一轮的加载态提前掐掉
        if (token === docsToken) docsLoading.value = false;
    }
}

/** 打开编辑：改名 / 描述 / embedding 模型（服务端 PATCH 已支持） */
function openEditKb(kb: KbItem) {
    editingKb.value = kb;
    Object.assign(editForm, { name: kb.name, description: kb.description, embeddingModel: kb.embeddingModel });
    editError.value = '';
}

async function saveKb() {
    if (!editingKb.value || savingKb.value) return;
    if (!editForm.name.trim()) {
        editError.value = t('adminForm.requiredName');
        return;
    }
    editError.value = '';
    savingKb.value = true;
    try {
        const updated = await $fetch<KbItem>(`/api/admin/knowledge-bases/${encodeURIComponent(editingKb.value.id)}`, {
            method: 'PATCH',
            body: { name: editForm.name, description: editForm.description, embeddingModel: editForm.embeddingModel },
        });
        // 同步当前面板标题，避免改名后仍显示旧名
        if (current.value?.id === updated.id) current.value = { ...current.value, ...updated };
        editingKb.value = null;
        await load();
    } catch (e) {
        editError.value = extractApiError(e, t('adminForm.saveFailed'));
    } finally {
        savingKb.value = false;
    }
}

async function removeKb(id: string) {
    if (!confirm(t('adminForm.kbDeleteConfirm'))) return;
    message.value = '';
    try {
        await $fetch(`/api/admin/knowledge-bases/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
    if (uploading.value) return;
    if (!current.value) return;
    const kbId = current.value.id;
    const file = fileRef.value?.files?.[0];
    uploading.value = true;
    message.value = '';
    try {
        if (file) {
            const form = new FormData();
            form.append('file', file);
            if (docForm.title) form.append('title', docForm.title);
            await $fetch(`/api/admin/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
                method: 'POST',
                body: form,
            });
        } else {
            if (!docForm.content.trim()) {
                message.value = t('adminForm.kbDocNeedContent');
                return;
            }
            await $fetch(`/api/admin/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
                method: 'POST',
                body: { title: docForm.title || undefined, content: docForm.content },
            });
        }
        message.value = t('adminForm.kbDocImported');
        docForm.title = '';
        docForm.content = '';
        if (fileRef.value) fileRef.value.value = '';
        await reloadDocs(kbId);
        await load();
    } catch (error) {
        message.value = extractApiError(error, t('adminForm.kbDocImportFailed'));
    } finally {
        uploading.value = false;
    }
}

async function removeDoc(id: string) {
    if (!current.value || !confirm(t('adminForm.kbDocDeleteConfirm'))) return;
    const kbId = current.value.id;
    try {
        await $fetch(`/api/admin/knowledge-bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await reloadDocs(kbId);
        await load();
    } catch (e) {
        message.value = extractApiError(e, t('adminForm.deleteFailed'));
    }
}

async function search() {
    if (!current.value || !searchQuery.value.trim()) return;
    const token = ++searchToken;
    message.value = '';
    // 先清空旧命中：慢响应期间界面不挂着上一次（可能是别的知识库/关键词）的结果
    searchHits.value = [];
    try {
        const res = await $fetch<{ hits: HitItem[] }>(`/api/admin/knowledge-bases/${encodeURIComponent(current.value.id)}/search`, {
            query: { q: searchQuery.value },
        });
        if (token !== searchToken) return;
        searchHits.value = res.hits;
    } catch (e) {
        if (token !== searchToken) return;
        message.value = extractApiError(e, t('adminForm.operationFailed'));
    }
}
</script>

<template>
    <div class="flex flex-col gap-6 lg:flex-row">
        <div class="w-full lg:w-1/2">
            <div class="app-page-header">
                <div>
                    <h1 class="app-page-title text-strong">{{ t('adminForm.kbTitle') }}</h1>
                    <p class="app-page-subtitle">{{ t('adminForm.kbSubtitle') }}</p>
                </div>
                <div class="app-page-actions">
                    <button class="app-btn app-btn-primary" @click="openCreateKb">{{ t('adminForm.kbCreate') }}</button>
                </div>
            </div>

            <div v-if="listError" class="app-alert app-alert-danger mb-4">
                {{ listError }}
                <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
            </div>

            <div class="app-table-wrap">
                <table class="app-table">
                    <thead>
                        <tr>
                            <th>{{ t('adminForm.kbColName') }}</th>
                            <th>{{ t('adminForm.kbColCounts') }}</th>
                            <th class="text-right">{{ t('adminForm.actions') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="kb in kbs" :key="kb.id">
                            <td class="app-table-cell-wrap">
                                <p class="text-strong font-medium">{{ kb.name }}</p>
                                <p class="text-faint mt-0.5 text-xs">
                                    {{ kb.description }} · {{ kb.providerName || t('adminForm.defaultProvider') }} /
                                    <span class="font-mono">{{ kb.embeddingModel }}</span>
                                </p>
                            </td>
                            <td class="text-muted-2 tabular-nums">{{ kb.documentCount }} / {{ kb.chunkCount }}</td>
                            <td>
                                <div class="app-table-actions">
                                    <button class="app-btn app-btn-outline app-btn-sm" @click="open(kb)">{{ t('adminForm.kbManage') }}</button>
                                    <button class="app-btn app-btn-ghost app-btn-sm" @click="openEditKb(kb)">{{ t('adminForm.edit') }}</button>
                                    <button class="app-btn app-btn-ghost app-btn-sm" :disabled="reindexing" @click="reindex(kb)">
                                        {{ t('adminForm.kbReindex') }}
                                    </button>
                                    <button class="app-btn app-btn-danger app-btn-sm" @click="removeKb(kb.id)">{{ t('adminForm.delete') }}</button>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="loading">
                            <td colspan="3">
                                <div class="space-y-2">
                                    <div v-for="i in 3" :key="i" class="app-skeleton h-8 !rounded-xl" />
                                </div>
                            </td>
                        </tr>
                        <tr v-else-if="!kbs.length">
                            <td colspan="3" class="!whitespace-normal">
                                <div class="app-empty">
                                    <span class="app-empty-icon">📚</span>
                                    <p class="app-empty-title">{{ t('adminForm.kbEmpty') }}</p>
                                    <p class="app-empty-desc">{{ t('adminForm.kbCreate') }}</p>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="current" class="w-full space-y-4 lg:w-1/2">
            <div class="app-card p-6">
                <div class="mb-3 flex items-center justify-between gap-3">
                    <h2 class="text-strong truncate font-bold">{{ current.name }} · {{ t('adminForm.kbDocs') }}</h2>
                    <button type="button" class="text-hover-strong text-faint text-sm" @click="current = null">{{ t('adminForm.kbClose') }}</button>
                </div>
                <div class="space-y-2">
                    <input
                        :aria-label="t('adminForm.kbDocTitlePlaceholder')"
                        v-model="docForm.title"
                        :placeholder="t('adminForm.kbDocTitlePlaceholder')"
                        class="app-input"
                    />
                    <input
                        ref="fileRef"
                        :aria-label="t('adminForm.kbDocFileLabel')"
                        type="file"
                        accept=".txt,.md,.markdown,.csv,.json"
                        class="text-muted-2 block w-full text-xs"
                    />
                    <textarea
                        :aria-label="t('adminForm.kbDocContentLabel')"
                        v-model="docForm.content"
                        rows="4"
                        :placeholder="t('adminForm.kbDocContentPlaceholder')"
                        class="app-input"
                    />
                    <button class="app-btn app-btn-primary" :disabled="uploading" @click="addDoc">
                        {{ uploading ? t('adminForm.kbDocImporting') : t('adminForm.kbDocImport') }}
                    </button>
                    <p v-if="message" class="text-muted-2 text-xs">{{ message }}</p>
                </div>
                <ul class="mt-4 space-y-1">
                    <li v-for="d in docs" :key="d.id" class="app-list-row">
                        <span class="text-strong min-w-0 truncate">{{ d.title }}</span>
                        <span class="app-chip shrink-0 tabular-nums">{{ t('adminForm.kbDocChunks', { n: d.chunkCount }) }}</span>
                        <button class="app-btn app-btn-danger app-btn-sm shrink-0" @click="removeDoc(d.id)">{{ t('adminForm.delete') }}</button>
                    </li>
                    <li v-if="docsLoading">
                        <div class="space-y-2">
                            <div v-for="i in 3" :key="i" class="app-skeleton h-8 !rounded-xl" />
                        </div>
                    </li>
                    <li v-else-if="!docs.length" class="text-faint py-4 text-center text-sm">{{ t('adminForm.kbDocEmpty') }}</li>
                </ul>
            </div>

            <div class="app-card p-6">
                <h3 class="text-strong mb-2 text-sm font-bold">{{ t('adminForm.kbSearchTitle') }}</h3>
                <div class="flex gap-2">
                    <input
                        v-model="searchQuery"
                        :placeholder="t('adminForm.kbSearchPlaceholder')"
                        :aria-label="t('adminForm.kbSearchTitle')"
                        class="app-input flex-1"
                        @keyup.enter="search"
                    />
                    <button class="app-btn app-btn-outline shrink-0" @click="search">{{ t('adminForm.kbSearchRun') }}</button>
                </div>
                <div class="mt-3 max-h-64 space-y-2 overflow-y-auto">
                    <div v-for="(hit, i) in searchHits" :key="i" class="app-panel p-3">
                        <p class="text-muted-2 mb-1 text-xs font-semibold tabular-nums">
                            {{ t('adminForm.kbSearchScore', { score: hit.score.toFixed(3) }) }}
                        </p>
                        <p class="text-soft text-xs whitespace-pre-wrap">{{ hit.content }}</p>
                    </div>
                    <p v-if="searchQuery && !searchHits.length" class="text-faint text-center text-sm">{{ t('adminForm.kbSearchEmpty') }}</p>
                </div>
            </div>
        </div>

        <!-- 新建知识库：名称/描述/embedding 模型 -->
        <AdminDrawer :open="createOpen" :title="t('adminForm.kbCreate')" @close="createOpen = false">
            <div class="space-y-3">
                <input :aria-label="t('adminForm.kbNamePlaceholder')" v-model="newKb.name" :placeholder="t('adminForm.kbNamePlaceholder')" class="app-input" />
                <input :aria-label="t('adminForm.description')" v-model="newKb.description" :placeholder="t('adminForm.description')" class="app-input" />
                <input
                    :aria-label="t('adminForm.kbEmbeddingModel')"
                    v-model="newKb.embeddingModel"
                    :placeholder="t('adminForm.kbEmbeddingModel')"
                    class="app-input !font-mono !text-xs"
                />
                <p v-if="createError" class="app-help-error">{{ createError }}</p>
            </div>
            <template #footer>
                <button class="app-btn app-btn-ghost" :disabled="creatingKb" @click="createOpen = false">{{ t('adminForm.cancel') }}</button>
                <button class="app-btn app-btn-primary" :disabled="creatingKb" @click="createKb">{{ t('adminForm.save') }}</button>
            </template>
        </AdminDrawer>

        <!-- 编辑知识库：改名/描述/embedding 模型（此前只能删库重建） -->
        <AdminDrawer :open="Boolean(editingKb)" :title="t('adminForm.kbEditTitle')" @close="editingKb = null">
            <div class="space-y-3">
                <input
                    :aria-label="t('adminForm.kbNamePlaceholder')"
                    v-model="editForm.name"
                    :placeholder="t('adminForm.kbNamePlaceholder')"
                    class="app-input"
                />
                <input :aria-label="t('adminForm.description')" v-model="editForm.description" :placeholder="t('adminForm.description')" class="app-input" />
                <input
                    :aria-label="t('adminForm.kbEmbeddingModel')"
                    v-model="editForm.embeddingModel"
                    :placeholder="t('adminForm.kbEmbeddingModel')"
                    class="app-input !font-mono !text-xs"
                />
                <p v-if="editError" class="app-help-error">{{ editError }}</p>
            </div>
            <template #footer>
                <button class="app-btn app-btn-ghost" :disabled="savingKb" @click="editingKb = null">{{ t('adminForm.cancel') }}</button>
                <button class="app-btn app-btn-primary" :disabled="savingKb" @click="saveKb">{{ t('adminForm.save') }}</button>
            </template>
        </AdminDrawer>
    </div>
</template>
