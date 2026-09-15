<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' });

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

const newKb = reactive({ name: '', description: '', embeddingModel: 'text-embedding-3-small' });
const docForm = reactive({ title: '', content: '' });
const searchQuery = ref('');
const searchHits = ref<HitItem[]>([]);
const uploading = ref(false);
const fileRef = ref<HTMLInputElement | null>(null);
const reindexing = ref(false);

/** 重建向量索引：修复嵌入接口故障期间入库的空向量分块 */
async function reindex(kb: KbItem) {
    if (!confirm(`确认重建「${kb.name}」的向量索引？将重新调用嵌入接口（${kb.chunkCount} 个分块）。`)) return;
    reindexing.value = true;
    message.value = '正在重建索引…';
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
            `索引重建完成：成功 ${res.updated}/${res.total} 块，失败 ${res.failed} 块（供应商：${res.knowledgeBase.provider}）` +
            (res.lastError ? ` · 失败原因：${res.lastError.slice(0, 160)}` : '');
    } catch (e: any) {
        message.value = e?.data?.statusMessage || e?.message || '索引重建失败';
    } finally {
        reindexing.value = false;
        await load();
    }
}

async function load() {
    kbs.value = await $fetch('/api/admin/knowledge-bases');
}

onMounted(load);

async function createKb() {
    if (!newKb.name.trim()) return;
    await $fetch('/api/admin/knowledge-bases', { method: 'POST', body: { ...newKb } });
    Object.assign(newKb, { name: '', description: '', embeddingModel: 'text-embedding-3-small' });
    await load();
}

async function open(kb: KbItem) {
    current.value = kb;
    docs.value = await $fetch(`/api/admin/knowledge-bases/${kb.id}/documents`);
    searchHits.value = [];
    message.value = '';
}

async function removeKb(id: string) {
    if (!confirm('确认删除该知识库及其全部文档？')) return;
    await $fetch(`/api/admin/knowledge-bases/${id}`, { method: 'DELETE' });
    if (current.value?.id === id) {
        current.value = null;
        docs.value = [];
    }
    await load();
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
                message.value = '请粘贴文本或选择文件';
                return;
            }
            await $fetch(`/api/admin/knowledge-bases/${current.value.id}/documents`, {
                method: 'POST',
                body: { title: docForm.title || undefined, content: docForm.content },
            });
        }
        message.value = '文档已导入并完成向量化';
        docForm.title = '';
        docForm.content = '';
        if (fileRef.value) fileRef.value.value = '';
        docs.value = await $fetch(`/api/admin/knowledge-bases/${current.value.id}/documents`);
        await load();
    } catch (error: unknown) {
        const err = error as { data?: { statusMessage?: string }; message?: string };
        message.value = err.data?.statusMessage ?? err.message ?? '导入失败';
    } finally {
        uploading.value = false;
    }
}

async function removeDoc(id: string) {
    if (!current.value || !confirm('确认删除该文档？')) return;
    await $fetch(`/api/admin/knowledge-bases/${current.value.id}/documents/${id}`, { method: 'DELETE' });
    docs.value = await $fetch(`/api/admin/knowledge-bases/${current.value.id}/documents`);
    await load();
}

async function search() {
    if (!current.value || !searchQuery.value.trim()) return;
    const res = await $fetch<{ hits: HitItem[] }>(`/api/admin/knowledge-bases/${current.value.id}/search`, {
        query: { q: searchQuery.value },
    });
    searchHits.value = res.hits;
}
</script>

<template>
    <div class="flex gap-6">
        <div class="w-1/2">
            <h1 class="mb-2 text-2xl font-bold text-gray-800">知识库</h1>
            <p class="mb-4 text-xs text-gray-400">文档自动分块并向量化；把知识库绑定到智能体后，对话时自动检索注入。</p>

            <div class="mb-4 flex gap-2 rounded-2xl bg-white p-4 shadow-sm">
                <input v-model="newKb.name" placeholder="知识库名称" class="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input v-model="newKb.description" placeholder="描述" class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input v-model="newKb.embeddingModel" placeholder="Embedding 模型" class="w-52 rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs" />
                <button class="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700" @click="createKb">创建</button>
            </div>

            <table class="w-full rounded-2xl bg-white text-sm shadow-sm">
                <thead class="text-left text-gray-400">
                    <tr>
                        <th class="p-4">知识库</th>
                        <th class="p-4">文档 / 分块</th>
                        <th class="p-4">操作</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="kb in kbs" :key="kb.id" class="border-t border-gray-100">
                        <td class="p-4">
                            <p class="font-medium text-gray-800">{{ kb.name }}</p>
                            <p class="text-xs text-gray-400">{{ kb.description }} · {{ kb.providerName || '默认供应商' }} / {{ kb.embeddingModel }}</p>
                        </td>
                        <td class="p-4 text-gray-500">{{ kb.documentCount }} / {{ kb.chunkCount }}</td>
                        <td class="space-x-2 p-4">
                            <button class="text-green-600 hover:underline" @click="open(kb)">管理</button>
                            <button class="text-blue-600 hover:underline disabled:opacity-50" :disabled="reindexing" @click="reindex(kb)">重建索引</button>
                            <button class="text-red-500 hover:underline" @click="removeKb(kb.id)">删除</button>
                        </td>
                    </tr>
                    <tr v-if="!kbs.length">
                        <td colspan="3" class="p-8 text-center text-gray-400">暂无知识库</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div v-if="current" class="w-1/2 space-y-4">
            <div class="rounded-2xl bg-white p-6 shadow-sm">
                <div class="mb-3 flex items-center justify-between">
                    <h2 class="font-bold text-gray-800">{{ current.name }} · 文档</h2>
                    <button class="text-sm text-gray-400 hover:text-gray-600" @click="current = null">关闭</button>
                </div>
                <div class="space-y-2">
                    <input v-model="docForm.title" placeholder="文档标题" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    <input ref="fileRef" type="file" accept=".txt,.md,.markdown,.csv,.json" class="block w-full text-xs text-gray-500" />
                    <textarea
                        v-model="docForm.content"
                        rows="4"
                        placeholder="或直接粘贴文本内容…"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <button
                        :disabled="uploading"
                        class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                        @click="addDoc"
                    >
                        {{ uploading ? '向量化中…' : '导入文档' }}
                    </button>
                    <p v-if="message" class="text-xs text-gray-500">{{ message }}</p>
                </div>
                <ul class="mt-4 space-y-1">
                    <li v-for="d in docs" :key="d.id" class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                        <span class="truncate text-gray-700"
                            >{{ d.title }} <span class="text-xs text-gray-400">（{{ d.chunkCount }} 块）</span></span
                        >
                        <button class="text-xs text-red-400 hover:text-red-500" @click="removeDoc(d.id)">删除</button>
                    </li>
                    <li v-if="!docs.length" class="py-4 text-center text-sm text-gray-400">暂无文档</li>
                </ul>
            </div>

            <div class="rounded-2xl bg-white p-6 shadow-sm">
                <h3 class="mb-2 text-sm font-bold text-gray-800">检索测试</h3>
                <div class="flex gap-2">
                    <input
                        v-model="searchQuery"
                        placeholder="输入测试问题…"
                        class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        @keyup.enter="search"
                    />
                    <button class="rounded-lg bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200" @click="search">检索</button>
                </div>
                <div class="mt-3 max-h-64 space-y-2 overflow-y-auto">
                    <div v-for="(hit, i) in searchHits" :key="i" class="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                        <p class="mb-1 font-semibold text-gray-500">相关度 {{ hit.score.toFixed(3) }}</p>
                        <p class="whitespace-pre-wrap">{{ hit.content }}</p>
                    </div>
                    <p v-if="searchQuery && !searchHits.length" class="text-center text-sm text-gray-400">无结果</p>
                </div>
            </div>
        </div>
    </div>
</template>
