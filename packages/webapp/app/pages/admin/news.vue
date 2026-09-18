<script setup lang="ts">
import { extractApiError, formatDate } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

interface NewsRow {
    id: string;
    title: string;
    summary: string;
    content: string;
    coverImage: string;
    category: string;
    tags: string[];
    status: string;
    pinned: boolean;
    viewCount: number;
    publishedAt: string | null;
    createdAt: string;
}

const { t } = useI18n();

const items = ref<NewsRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const error = ref('');
const success = ref('');
const keyword = ref('');
const status = ref('all');
const saving = ref(false);
/** 编辑时正文按需拉取（列表接口不返回 content） */
const loadingContent = ref(false);

const emptyForm = () => ({
    title: '',
    summary: '',
    content: '',
    coverImage: '',
    category: 'general',
    tagsText: '',
    status: 'draft',
    pinned: false,
    publishedAt: '',
});

const editing = ref<Partial<NewsRow> | null>(null);
const form = reactive(emptyForm());

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
    loading.value = true;
    error.value = '';
    try {
        const res = await $fetch<{ items: NewsRow[]; total: number }>('/api/admin/news', {
            query: { page: page.value, pageSize, status: status.value === 'all' ? undefined : status.value, keyword: keyword.value || undefined },
        });
        items.value = res.items;
        total.value = res.total;
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

/** 搜索防抖；卸载时清理，避免组件销毁后仍触发请求 */
let timer: ReturnType<typeof setTimeout> | null = null;
watch(keyword, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        page.value = 1;
        void load();
    }, 300);
});
onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
});

watch(status, () => {
    page.value = 1;
    void load();
});

function openCreate() {
    editing.value = {};
    Object.assign(form, emptyForm());
    error.value = '';
}

/**
 * 打开编辑：列表接口不返回正文（避免列表页传输大量 Markdown），
 * 因此这里按 id 拉一次详情再回填。
 * 此前直接读 row.content（undefined）会让正文框显示为空，
 * 管理员一保存就把原文整段覆盖掉——这是会丢数据的缺陷。
 */
function openEdit(row: NewsRow) {
    editing.value = row;
    Object.assign(form, {
        title: row.title,
        summary: row.summary,
        content: '',
        coverImage: row.coverImage,
        category: row.category,
        tagsText: (row.tags ?? []).join(', '),
        status: row.status,
        pinned: row.pinned,
        publishedAt: row.publishedAt ? String(row.publishedAt).slice(0, 10) : '',
    });
    error.value = '';
    loadingContent.value = true;
    $fetch<{ content?: string }>(`/api/admin/news/${row.id}`)
        .then((detail) => {
            // 仅当用户仍停留在同一条记录时才回填，避免快速切换时串内容
            if (editing.value?.id === row.id) form.content = detail.content ?? '';
        })
        .catch((e) => {
            error.value = extractApiError(e, t('common.loadFailed'));
        })
        .finally(() => {
            loadingContent.value = false;
        });
}

async function save() {
    if (!form.title.trim()) {
        error.value = '标题必填';
        return;
    }
    // 正文仍在拉取时禁止保存：此时 form.content 还是空串，直接 PATCH 会把原文整段覆盖丢失。
    if (loadingContent.value) {
        error.value = t('adminForm.loadingContent');
        return;
    }
    saving.value = true;
    error.value = '';
    try {
        const body = {
            title: form.title,
            summary: form.summary,
            content: form.content,
            coverImage: form.coverImage,
            category: form.category,
            tags: form.tagsText
                .split(/[,，]/)
                .map((v) => v.trim())
                .filter(Boolean),
            status: form.status,
            pinned: form.pinned,
            ...(form.publishedAt ? { publishedAt: new Date(form.publishedAt).toISOString() } : {}),
        };
        if (editing.value?.id) {
            await $fetch(`/api/admin/news/${editing.value.id}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/news', { method: 'POST', body });
        }
        success.value = t('common.saved');
        editing.value = null;
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        saving.value = false;
    }
}

async function toggleStatus(row: NewsRow) {
    try {
        await $fetch(`/api/admin/news/${row.id}`, { method: 'PATCH', body: { status: row.status === 'published' ? 'draft' : 'published' } });
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function togglePin(row: NewsRow) {
    try {
        await $fetch(`/api/admin/news/${row.id}`, { method: 'PATCH', body: { pinned: !row.pinned } });
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function remove(row: NewsRow) {
    if (!confirm(`确定删除「${row.title}」？`)) return;
    try {
        await $fetch(`/api/admin/news/${row.id}`, { method: 'DELETE' });
        success.value = t('common.deleted');
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

function goPage(next: number) {
    if (next < 1 || next > totalPages.value) return;
    page.value = next;
    void load();
}
</script>

<template>
    <div class="space-y-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">{{ t('nav.news') }}</h1>
                <p class="mt-1 text-xs text-gray-400">{{ t('news.subtitle') }}</p>
            </div>
            <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">
                {{ t('admin.addRecord') }}
            </button>
        </div>

        <div v-if="error" class="rounded-xl bg-red-50 p-3 text-sm text-red-600">{{ error }}</div>
        <div v-if="success" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{{ success }}</div>

        <!-- 编辑表单 -->
        <div v-if="editing !== null" class="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <div class="grid gap-3 sm:grid-cols-2">
                <input v-model="form.title" placeholder="标题" class="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2" />
                <input v-model="form.category" placeholder="分类，如 product / guide" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input v-model="form.tagsText" placeholder="标签，逗号分隔" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <!-- 封面：可从附件选择或直接上传，避免手填会过期的预签名地址 -->
                <div class="sm:col-span-2">
                    <ImagePicker v-model="form.coverImage" :placeholder="t('adminForm.coverImagePlaceholder')" />
                </div>
                <textarea
                    v-model="form.summary"
                    rows="2"
                    placeholder="摘要（列表展示）"
                    class="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
                />
                <div class="sm:col-span-2">
                    <textarea
                        v-model="form.content"
                        rows="10"
                        :placeholder="loadingContent ? t('adminForm.loadingContent') : t('adminForm.newsContentPlaceholder')"
                        :disabled="loadingContent"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs disabled:bg-gray-50 disabled:opacity-60"
                    />
                    <p v-if="loadingContent" class="mt-1 text-[11px] text-gray-400">{{ t('adminForm.loadingContent') }}</p>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-4">
                <select v-model="form.status" class="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                </select>
                <input v-model="form.publishedAt" type="date" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <label class="flex items-center gap-2 text-sm text-gray-600">
                    <input v-model="form.pinned" type="checkbox" />
                    <span>置顶</span>
                </label>
            </div>
            <div class="flex gap-2">
                <button
                    class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                    :disabled="saving || loadingContent"
                    @click="save"
                >
                    {{ t('common.save') }}
                </button>
                <button class="rounded-lg bg-gray-100 px-4 py-1.5 text-sm" @click="editing = null">{{ t('common.cancel') }}</button>
            </div>
        </div>

        <!-- 列表 -->
        <div class="rounded-2xl bg-white p-6 shadow-sm">
            <div class="mb-4 flex flex-wrap items-center gap-3 text-xs">
                <input v-model="keyword" :placeholder="t('common.search')" class="rounded-lg border border-gray-300 px-3 py-1.5" />
                <select v-model="status" class="rounded-lg border border-gray-300 px-3 py-1.5">
                    <option value="all">{{ t('common.all') }}</option>
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                </select>
                <span class="text-gray-400">{{ t('common.total') }} {{ total }}</span>
            </div>

            <div v-if="loading" class="space-y-2">
                <div v-for="i in 3" :key="i" class="h-16 animate-pulse rounded-xl bg-gray-50" />
            </div>

            <div v-else class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="text-left text-xs text-gray-400">
                        <tr>
                            <th class="py-2 pr-4">标题</th>
                            <th class="py-2 pr-4">分类</th>
                            <th class="py-2 pr-4">状态</th>
                            <th class="py-2 pr-4">阅读</th>
                            <th class="py-2 pr-4">发布时间</th>
                            <th class="py-2">{{ t('common.actions') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in items" :key="row.id" class="border-t border-gray-100">
                            <td class="py-3 pr-4">
                                <div class="flex items-center gap-2">
                                    <span v-if="row.pinned" class="text-[10px] text-amber-500">📌</span>
                                    <div class="min-w-0">
                                        <p class="max-w-[22rem] truncate font-medium text-gray-800">{{ row.title }}</p>
                                        <p class="max-w-[22rem] truncate text-[11px] text-gray-400">{{ row.summary }}</p>
                                    </div>
                                </div>
                            </td>
                            <td class="py-3 pr-4 text-xs text-gray-500">{{ row.category }}</td>
                            <td class="py-3 pr-4">
                                <button
                                    :class="row.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'"
                                    class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                                    @click="toggleStatus(row)"
                                >
                                    {{ row.status === 'published' ? '已发布' : '草稿' }}
                                </button>
                            </td>
                            <td class="py-3 pr-4 text-xs text-gray-500">{{ row.viewCount }}</td>
                            <td class="py-3 pr-4 text-xs text-gray-400">{{ formatDate(row.publishedAt || row.createdAt) }}</td>
                            <td class="space-x-2 py-3 text-xs whitespace-nowrap">
                                <button class="text-emerald-600 hover:underline" @click="togglePin(row)">{{ row.pinned ? '取消置顶' : '置顶' }}</button>
                                <button class="text-emerald-600 hover:underline" @click="openEdit(row)">{{ t('common.edit') }}</button>
                                <button class="text-red-500 hover:underline" @click="remove(row)">{{ t('common.delete') }}</button>
                            </td>
                        </tr>
                        <tr v-if="!items.length">
                            <td colspan="6" class="py-8 text-center text-xs text-gray-400">{{ t('admin.tableEmpty') }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="totalPages > 1" class="mt-4 flex items-center justify-end gap-2 text-xs">
                <button class="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
                <span>{{ page }} / {{ totalPages }}</span>
                <button class="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" :disabled="page >= totalPages" @click="goPage(page + 1)">
                    下一页
                </button>
            </div>
        </div>
    </div>
</template>
