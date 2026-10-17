<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

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
/**
 * 表格行级操作的提示（重建索引、删除知识库、跨库导入/删除的迟到结果）。
 * `message` 只在右侧文档面板里渲染，而重建索引/删除是左侧表格上的按钮——
 * 没有选中知识库时写进 message 等于什么都没提示。
 */
const listMessage = ref('');
const loading = ref(true); // 首帧即加载态：数据要等挂载后的请求，初值 false 会让「暂无…」空态先闪一帧，SSR 首屏更是直接把空态发给用户
/** 右侧文档列表同理：open() 后要等 documents 请求返回，期间不能把「暂无文档」当空态显示 */
const docsLoading = ref(false);
/** 文档列表自己的加载错误：与 message（成功提示位）分开，否则「读不到文档」会显示成「这个库还没有文档」 */
const docsError = ref('');

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
/**
 * 是否真的跑过一次检索。
 * 此前空态判据是「有关键词且没有命中」——刚在输入框敲一个字就会显示「没有命中」，
 * 而那次检索根本没发出；切换知识库后同样会带着旧关键词误报。
 */
const searchRan = ref(false);
const uploading = ref(false);
/** 新建/编辑知识库的提交中标记：原本没有 disabled，双击会建出两条同名知识库 */
const creatingKb = ref(false);
const savingKb = ref(false);
const fileRef = ref<HTMLInputElement | null>(null);
const reindexing = ref(false);
/** 新建抽屉归属令牌：与编辑抽屉同理，创建期间关掉再打开时，迟到的响应不能清空新表单 */
let kbCreateToken = 0;
/**
 * 编辑抽屉归属令牌：保存期间用 ✕/Esc 关掉 A 再打开 B，迟到的成功会无条件把 B 的抽屉关掉，
 * 用户正在改的内容看不到也存不下。每次打开编辑换发令牌，响应落地前比对。
 */
let kbEditToken = 0;

/** 重建向量索引：修复嵌入接口故障期间入库的空向量分块 */
async function reindex(kb: KbItem) {
    if (reindexing.value) return;
    if (!confirm(t('adminForm.kbReindexConfirm', { name: kb.name, chunks: kb.chunkCount }))) return;
    reindexing.value = true;
    listMessage.value = t('adminForm.kbReindexing');
    try {
        const res = await $fetch<{
            ok: boolean;
            updated: number;
            failed: number;
            total: number;
            lastError?: string | null;
            knowledgeBase: { provider: string };
        }>(`/api/settings/knowledge-bases/${encodeURIComponent(kb.id)}/reindex`, { method: 'POST' });
        listMessage.value =
            t('adminForm.kbReindexDone', {
                updated: res.updated,
                total: res.total,
                failed: res.failed,
                provider: res.knowledgeBase.provider,
            }) + (res.lastError ? t('adminForm.kbReindexReason', { reason: res.lastError.slice(0, 160) }) : '');
    } catch (e) {
        listMessage.value = extractApiError(e, t('adminForm.kbReindexFailed'));
    } finally {
        reindexing.value = false;
        await load();
    }
}

async function load() {
    loading.value = true;
    try {
        kbs.value = await $fetch<KbItem[]>('/api/settings/knowledge-bases');
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
    kbCreateToken += 1;
    // 上一张表单的在途创建已经不属于这里，不复位会让新表单的保存按钮一直停在「保存中」
    creatingKb.value = false;
    Object.assign(newKb, { name: '', description: '', embeddingModel: 'text-embedding-3-small' });
    createError.value = '';
    createOpen.value = true;
}

/** 关闭新建抽屉：令牌一并作废，在途创建的失败提示不能写进一个已经关掉的抽屉 */
function closeCreateKb() {
    kbCreateToken += 1;
    createOpen.value = false;
    creatingKb.value = false;
}

async function createKb() {
    if (creatingKb.value) return;
    createError.value = '';
    if (!newKb.name.trim()) {
        createError.value = t('adminForm.requiredName');
        return;
    }
    creatingKb.value = true;
    const token = kbCreateToken;
    try {
        await $fetch('/api/settings/knowledge-bases', { method: 'POST', body: { ...newKb } });
        // 创建期间用户可能已关掉抽屉并重新打开：清空与关闭只对发起这次创建的那张表单生效
        if (token === kbCreateToken) {
            Object.assign(newKb, { name: '', description: '', embeddingModel: 'text-embedding-3-small' });
            createOpen.value = false;
        }
        await load();
    } catch (e) {
        const failure = extractApiError(e, t('adminForm.saveFailed'));
        // 抽屉已关或已换成新的一张：这条失败属于上一次创建，改挂到页面级提示
        if (token === kbCreateToken) createError.value = failure;
        else listMessage.value = failure;
    } finally {
        if (token === kbCreateToken) creatingKb.value = false;
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
    searchRan.value = false;
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
    docsError.value = '';
    try {
        const rows = await $fetch<DocItem[]>(`/api/settings/knowledge-bases/${encodeURIComponent(kbId)}/documents`);
        if (token !== docsToken || current.value?.id !== kbId) return;
        docs.value = rows;
    } catch (e) {
        if (token !== docsToken || current.value?.id !== kbId) return;
        docs.value = [];
        docsError.value = extractApiError(e, t('adminForm.loadFailed'));
    } finally {
        // 只有最新一次请求可以收尾，且必须仍停在同一个知识库：切换后 addDoc/removeDoc
        // 还会拿着旧 kbId 回来刷新，此时 docsToken 已是新一轮的值，
        // 只比 token 会让旧库的 finally 把新面板的骨架屏提前摘掉（界面上直接变成「暂无文档」）。
        if (token === docsToken && current.value?.id === kbId) docsLoading.value = false;
    }
}

/** 打开编辑：改名 / 描述 / embedding 模型（服务端 PATCH 已支持） */
/** 关闭编辑抽屉：令牌一并作废——在途保存的失败提示不能写进一个已经关掉的抽屉 */
function closeEditKb() {
    kbEditToken += 1;
    editingKb.value = null;
    savingKb.value = false;
}

function openEditKb(kb: KbItem) {
    kbEditToken += 1;
    // 上一张表单的在途保存已经不属于这里，不复位会让新表单的保存按钮一直停在「保存中」
    savingKb.value = false;
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
    const token = kbEditToken;
    try {
        const { vectorsInvalidated, ...updated } = await $fetch<KbItem & { vectorsInvalidated?: number }>(
            `/api/settings/knowledge-bases/${encodeURIComponent(editingKb.value.id)}`,
            { method: 'PATCH', body: { name: editForm.name, description: editForm.description, embeddingModel: editForm.embeddingModel } },
        );
        // 同步当前面板标题，避免改名后仍显示旧名
        if (current.value?.id === updated.id) current.value = { ...current.value, ...updated };
        // 保存期间用户可能已改开另一条知识库：无条件清空会把他正在填的表单一起关掉
        if (token === kbEditToken) editingKb.value = null;
        // 服务端在换了嵌入模型/供应商时会连带作废旧向量，必须当场说破：
        // 否则用户只看到「保存成功」，之后才发现这个库的检索质量莫名变差，
        // 而界面上既没有「向量已空」的标记、日志里也什么都没有。
        // 提示要落到当前看得见的位置：没有打开文档面板时 message 无处渲染。
        if (vectorsInvalidated !== undefined) {
            const note = vectorsInvalidated ? t('adminForm.kbEmbeddingStale', { chunks: vectorsInvalidated }) : t('adminForm.kbEmbeddingStaleNone');
            if (current.value?.id === updated.id) message.value = note;
            else listMessage.value = note;
        }
        await load();
    } catch (e) {
        const failure = extractApiError(e, t('adminForm.saveFailed'));
        // 抽屉已换成另一条知识库时，这条失败属于上一条：写进当前表单会被读成本次编辑的问题
        if (token === kbEditToken) editError.value = failure;
        else listMessage.value = failure;
    } finally {
        if (token === kbEditToken) savingKb.value = false;
    }
}

async function removeKb(id: string) {
    if (!confirm(t('adminForm.kbDeleteConfirm'))) return;
    listMessage.value = '';
    try {
        await $fetch(`/api/settings/knowledge-bases/${encodeURIComponent(id)}`, { method: 'DELETE' });
        listMessage.value = t('common.deleted');
        if (current.value?.id === id) {
            current.value = null;
            docs.value = [];
        }
        await load();
    } catch (e) {
        listMessage.value = extractApiError(e, t('adminForm.deleteFailed'));
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
            await $fetch(`/api/settings/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
                method: 'POST',
                body: form,
            });
        } else {
            if (!docForm.content.trim()) {
                message.value = t('adminForm.kbDocNeedContent');
                return;
            }
            await $fetch(`/api/settings/knowledge-bases/${encodeURIComponent(kbId)}/documents`, {
                method: 'POST',
                body: { title: docForm.title || undefined, content: docForm.content },
            });
        }
        docForm.title = '';
        docForm.content = '';
        if (fileRef.value) fileRef.value.value = '';
        // 导入期间用户可能已切到另一个库：文档列表与成功提示都属于被导入的那个库，
        // 旧库的刷新写进新面板会变成「B 的文档区列着 A 的导入结果」。
        if (current.value?.id === kbId) {
            message.value = t('adminForm.kbDocImported');
            await reloadDocs(kbId);
        }
        await load();
    } catch (error) {
        const failure = extractApiError(error, t('adminForm.kbDocImportFailed'));
        // 导入期间切到了另一个库：这条失败属于被导入的那个库，写进当前面板会被读成本库导入失败
        if (current.value?.id === kbId) message.value = failure;
        else listMessage.value = failure;
    } finally {
        uploading.value = false;
    }
}

async function removeDoc(id: string) {
    if (!current.value || !confirm(t('adminForm.kbDocDeleteConfirm'))) return;
    const kbId = current.value.id;
    try {
        await $fetch(`/api/settings/knowledge-bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await reloadDocs(kbId);
        await load();
    } catch (e) {
        const failure = extractApiError(e, t('adminForm.deleteFailed'));
        // 删除期间切到了另一个库：失败提示不能写进新面板（那里列的是 B 的文档）
        if (current.value?.id === kbId) message.value = failure;
        else listMessage.value = failure;
    }
}

async function search() {
    if (!current.value || !searchQuery.value.trim()) return;
    const token = ++searchToken;
    message.value = '';
    // 先清空旧命中：慢响应期间界面不挂着上一次（可能是别的知识库/关键词）的结果
    searchHits.value = [];
    searchRan.value = false;
    try {
        const res = await $fetch<{ hits: HitItem[] }>(`/api/settings/knowledge-bases/${encodeURIComponent(current.value.id)}/search`, {
            query: { q: searchQuery.value },
        });
        if (token !== searchToken) return;
        searchHits.value = res.hits;
        searchRan.value = true;
    } catch (e) {
        if (token !== searchToken) return;
        message.value = extractApiError(e, t('adminForm.operationFailed'));
    }
}
</script>

<template>
    <div class="space-y-5">
        <WorkSettingsNav />
        <div class="flex flex-col gap-6 lg:flex-row">
            <div class="w-full lg:w-1/2">
                <div class="app-page-header">
                    <div>
                        <h1 class="app-page-title text-strong">{{ t('settings.navKnowledge') }}</h1>
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
                <!-- 行级操作的反馈：重建索引/删除等按钮在左侧表格上，不能依赖右侧文档面板来显示结果 -->
                <div v-if="listMessage" class="app-alert app-alert-info mb-4 text-xs">{{ listMessage }}</div>

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
                            <!-- 加载失败时不渲染空态：接口故障不能被读成「没有数据」 -->
                            <tr v-else-if="!listError && !kbs.length">
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
                        <li v-else-if="docsError" class="app-help-error py-4 text-center text-sm">
                            {{ docsError }}
                            <button type="button" class="ml-2 underline hover:no-underline" @click="current && reloadDocs(current.id)">
                                {{ t('common.retry') }}
                            </button>
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
                        <p v-if="searchRan && !searchHits.length" class="text-faint text-center text-sm">{{ t('adminForm.kbSearchEmpty') }}</p>
                    </div>
                </div>
            </div>

            <!-- 新建知识库：名称/描述/embedding 模型 -->
            <AdminDrawer :open="createOpen" :title="t('adminForm.kbCreate')" @close="closeCreateKb">
                <div class="space-y-3">
                    <input
                        :aria-label="t('adminForm.kbNamePlaceholder')"
                        v-model="newKb.name"
                        :placeholder="t('adminForm.kbNamePlaceholder')"
                        class="app-input"
                    />
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
                    <button class="app-btn app-btn-ghost" :disabled="creatingKb" @click="closeCreateKb">{{ t('adminForm.cancel') }}</button>
                    <button class="app-btn app-btn-primary" :disabled="creatingKb" @click="createKb">{{ t('adminForm.save') }}</button>
                </template>
            </AdminDrawer>

            <!-- 编辑知识库：改名/描述/embedding 模型（此前只能删库重建） -->
            <AdminDrawer :open="Boolean(editingKb)" :title="t('adminForm.kbEditTitle')" @close="closeEditKb">
                <div class="space-y-3">
                    <input
                        :aria-label="t('adminForm.kbNamePlaceholder')"
                        v-model="editForm.name"
                        :placeholder="t('adminForm.kbNamePlaceholder')"
                        class="app-input"
                    />
                    <input
                        :aria-label="t('adminForm.description')"
                        v-model="editForm.description"
                        :placeholder="t('adminForm.description')"
                        class="app-input"
                    />
                    <input
                        :aria-label="t('adminForm.kbEmbeddingModel')"
                        v-model="editForm.embeddingModel"
                        :placeholder="t('adminForm.kbEmbeddingModel')"
                        class="app-input !font-mono !text-xs"
                    />
                    <p v-if="editError" class="app-help-error">{{ editError }}</p>
                </div>
                <template #footer>
                    <button class="app-btn app-btn-ghost" :disabled="savingKb" @click="closeEditKb">{{ t('adminForm.cancel') }}</button>
                    <button class="app-btn app-btn-primary" :disabled="savingKb" @click="saveKb">{{ t('adminForm.save') }}</button>
                </template>
            </AdminDrawer>
        </div>
    </div>
</template>
