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
/** 正文拉取失败：此时 form.content 仍是空串，必须禁止保存，否则会把原文整段覆盖丢失 */
const contentFailed = ref(false);

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
    contentFailed.value = false;
    error.value = '';
}

/**
 * 打开编辑：列表接口不返回正文（避免列表页传输大量 Markdown），
 * 因此这里按 id 拉一次详情再回填。
 * 此前直接读 row.content（undefined）会让正文框显示为空，
 * 管理员一保存就把原文整段覆盖掉——这是会丢数据的缺陷。
 * 拉取失败同样不能保存：见 contentFailed。
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
    void fetchContent(row);
}

/** 按 id 拉正文回填；仅当用户仍停留在同一条记录时才写入，避免快速切换时串内容 */
async function fetchContent(row: NewsRow) {
    loadingContent.value = true;
    contentFailed.value = false;
    try {
        const detail = await $fetch<{ content?: string }>(`/api/admin/news/${row.id}`);
        if (editing.value?.id === row.id) form.content = detail.content ?? '';
    } catch (e) {
        if (editing.value?.id === row.id) contentFailed.value = true;
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loadingContent.value = false;
    }
}

function retryContent() {
    const row = editing.value;
    if (row?.id) void fetchContent(row as NewsRow);
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
    if (contentFailed.value) {
        error.value = t('adminForm.contentLoadFailed');
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
        <div class="app-page-header !mb-0">
            <div>
                <h1 class="app-page-title text-strong">{{ t('nav.news') }}</h1>
                <p class="app-page-subtitle">{{ t('news.subtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <button class="app-btn app-btn-primary" @click="openCreate">{{ t('admin.addRecord') }}</button>
            </div>
        </div>

        <div v-if="error" class="app-alert app-alert-danger">{{ error }}</div>
        <div v-if="success" class="app-alert app-alert-success">{{ success }}</div>

        <!-- 编辑表单（右侧抽屉） -->
        <AdminDrawer :open="editing !== null" :title="editing?.id ? t('common.edit') : t('admin.addRecord')" width-class="sm:max-w-2xl" @close="editing = null">
            <div class="space-y-3">
                <div class="grid gap-3 sm:grid-cols-2">
                    <input v-model="form.title" placeholder="标题" class="app-input sm:col-span-2" />
                    <input v-model="form.category" placeholder="分类，如 product / guide" class="app-input" />
                    <input v-model="form.tagsText" placeholder="标签，逗号分隔" class="app-input" />
                    <!-- 封面：可从附件选择或直接上传，避免手填会过期的预签名地址 -->
                    <div class="sm:col-span-2">
                        <ImagePicker v-model="form.coverImage" :placeholder="t('adminForm.coverImagePlaceholder')" />
                    </div>
                    <textarea v-model="form.summary" rows="2" placeholder="摘要（列表展示）" class="app-input sm:col-span-2" />
                    <div class="sm:col-span-2">
                        <textarea
                            v-model="form.content"
                            rows="10"
                            :placeholder="loadingContent ? t('adminForm.loadingContent') : t('adminForm.newsContentPlaceholder')"
                            :disabled="loadingContent || contentFailed"
                            class="app-input !font-mono !text-xs"
                        />
                        <p v-if="loadingContent" class="text-faint mt-1 text-[11px]">{{ t('adminForm.loadingContent') }}</p>
                        <p v-else-if="contentFailed" class="app-help-error mt-1 text-[11px]">
                            {{ t('adminForm.contentLoadFailed') }}
                            <button type="button" class="underline hover:no-underline" @click="retryContent">{{ t('common.retry') }}</button>
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                    <select v-model="form.status" class="app-input !w-auto">
                        <option value="draft">草稿</option>
                        <option value="published">已发布</option>
                    </select>
                    <input v-model="form.publishedAt" type="date" class="app-input !w-auto" />
                    <label class="text-soft flex items-center gap-2 text-sm">
                        <input v-model="form.pinned" type="checkbox" class="app-checkbox" />
                        <span>置顶</span>
                    </label>
                </div>
            </div>
            <template #footer>
                <button class="app-btn app-btn-ghost" @click="editing = null">{{ t('common.cancel') }}</button>
                <button class="app-btn app-btn-primary" :disabled="saving || loadingContent || contentFailed" @click="save">
                    {{ t('common.save') }}
                </button>
            </template>
        </AdminDrawer>

        <!-- 列表 -->
        <div class="app-card p-6">
            <div class="mb-4 flex flex-wrap items-center gap-3">
                <input v-model="keyword" :placeholder="t('common.search')" class="app-input !w-48 !py-1.5 !text-xs" />
                <select v-model="status" class="app-input !w-auto !py-1.5 !text-xs">
                    <option value="all">{{ t('common.all') }}</option>
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                </select>
                <span class="text-faint text-xs">{{ t('common.total') }} {{ total }}</span>
            </div>

            <div v-if="loading" class="space-y-2">
                <div v-for="i in 3" :key="i" class="app-skeleton h-16 !rounded-xl" />
            </div>

            <div v-else class="overflow-x-auto">
                <table class="app-table">
                    <thead>
                        <tr>
                            <th>标题</th>
                            <th>分类</th>
                            <th>状态</th>
                            <th>阅读</th>
                            <th>发布时间</th>
                            <th class="text-right">{{ t('common.actions') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in items" :key="row.id">
                            <td class="app-table-cell-wrap">
                                <div class="flex items-center gap-2">
                                    <span v-if="row.pinned" aria-hidden="true">📌</span>
                                    <div class="min-w-0">
                                        <p class="text-strong font-medium">{{ row.title }}</p>
                                        <p class="text-faint text-[11px]">{{ row.summary }}</p>
                                    </div>
                                </div>
                            </td>
                            <td class="text-muted-2 text-xs">{{ row.category }}</td>
                            <td>
                                <button
                                    :class="row.status === 'published' ? 'app-badge-success' : 'app-badge-neutral'"
                                    class="app-badge"
                                    @click="toggleStatus(row)"
                                >
                                    {{ row.status === 'published' ? '已发布' : '草稿' }}
                                </button>
                            </td>
                            <td class="text-muted-2 text-xs tabular-nums">{{ row.viewCount }}</td>
                            <td class="text-faint text-xs">{{ formatDate(row.publishedAt || row.createdAt) }}</td>
                            <td>
                                <div class="app-table-actions">
                                    <button class="app-btn app-btn-ghost app-btn-sm" @click="togglePin(row)">{{ row.pinned ? '取消置顶' : '置顶' }}</button>
                                    <button class="app-btn app-btn-ghost app-btn-sm" @click="openEdit(row)">{{ t('common.edit') }}</button>
                                    <button class="app-btn app-btn-danger app-btn-sm" @click="remove(row)">{{ t('common.delete') }}</button>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="!items.length">
                            <td colspan="6" class="!whitespace-normal">
                                <div class="app-empty">
                                    <span class="app-empty-icon">📰</span>
                                    <p class="app-empty-title">{{ t('admin.tableEmpty') }}</p>
                                    <p class="app-empty-desc">{{ t('admin.addRecord') }}</p>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="totalPages > 1" class="mt-4 flex items-center justify-end gap-2 text-xs">
                <button class="app-btn app-btn-outline app-btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
                <span class="text-muted-2 tabular-nums">{{ page }} / {{ totalPages }}</span>
                <button class="app-btn app-btn-outline app-btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
            </div>
        </div>
    </div>
</template>
