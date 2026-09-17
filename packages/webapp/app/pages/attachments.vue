<script setup lang="ts">
import { ATTACHMENT_CATEGORIES, extractApiError, formatBytes, formatDate, type AttachmentRecord } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const { t } = useI18n();

const attachments = ref<AttachmentRecord[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 12;
const loading = ref(false);
const uploading = ref(false);
const error = ref('');
const success = ref('');
const keyword = ref('');
const category = ref('all');
const fileInput = ref<HTMLInputElement | null>(null);
const dragActive = ref(false);
const uploadCategory = ref('chat');
const previewUrl = ref('');

interface CategoryStat {
    category: string;
    count: number;
    bytes: number;
}
/** 全量分类占用（不随筛选变化，便于稳定展示空间去向） */
const stats = ref<{ totalCount: number; totalBytes: number; byCategory: CategoryStat[] }>({ totalCount: 0, totalBytes: 0, byCategory: [] });

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const canUpload = computed(() => !uploading.value);

/** 各分类的数量，用于筛选按钮角标 */
const categoryCounts = computed(() => {
    const map = new Map<string, number>();
    for (const row of stats.value.byCategory) map.set(row.category, row.count);
    return map;
});

/** 概要文案：总数 + 占用体积（+ 筛选结果条数），在脚本内拼装以保证 i18n 一致 */
const summaryText = computed(() => {
    let text = t('attachments.totalCount', { n: stats.value.totalCount });
    if (stats.value.totalBytes) text += ` · ${formatBytes(stats.value.totalBytes)}`;
    if (total.value !== stats.value.totalCount) text += ` · ${t('attachments.filteredCount', { n: total.value })}`;
    return text;
});

/** 分类占用占比对应的进度条宽度；占比过小时保留可见宽度 */
function usageWidth(bytes: number): string {
    if (!stats.value.totalBytes) return '0%';
    return `${Math.max(2, Math.round((bytes / stats.value.totalBytes) * 100))}%`;
}

async function load() {
    loading.value = true;
    error.value = '';
    try {
        const res = await $fetch<{
            attachments: AttachmentRecord[];
            total: number;
            stats?: { totalCount: number; totalBytes: number; byCategory: CategoryStat[] };
        }>('/api/attachments', {
            query: {
                page: page.value,
                pageSize,
                category: category.value === 'all' ? undefined : category.value,
                keyword: keyword.value || undefined,
            },
        });
        attachments.value = res.attachments;
        total.value = res.total;
        if (res.stats) stats.value = res.stats;
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(keyword, () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        page.value = 1;
        load();
    }, 300);
});

watch(category, () => {
    page.value = 1;
    load();
});

function goPage(next: number) {
    if (next < 1 || next > totalPages.value) return;
    page.value = next;
    load();
}

function pickFile() {
    fileInput.value?.click();
}

async function onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) await uploadFiles(files);
    input.value = '';
}

async function uploadFiles(files: File[]) {
    if (!files.length) return;
    uploading.value = true;
    error.value = '';
    success.value = '';
    let done = 0;
    const failures: string[] = [];
    for (const file of files) {
        try {
            const form = new FormData();
            form.append('file', file);
            form.append('category', uploadCategory.value);
            await $fetch('/api/attachments', { method: 'POST', body: form });
            done += 1;
        } catch (e) {
            failures.push(`${file.name}：${extractApiError(e, t('common.error'))}`);
        }
    }
    uploading.value = false;
    if (done) {
        success.value = t('attachments.uploadedCount', { n: done });
        page.value = 1;
        await load();
    }
    if (failures.length) error.value = failures.join('；');
}

function onDrop(event: DragEvent) {
    dragActive.value = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void uploadFiles(files);
}

async function remove(item: AttachmentRecord) {
    if (!confirm(t('attachments.deleteConfirm', { name: item.filename }))) return;
    try {
        await $fetch(`/api/attachments/${item.id}`, { method: 'DELETE' });
        success.value = t('common.deleted');
        if (attachments.value.length === 1 && page.value > 1) page.value -= 1;
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function download(item: AttachmentRecord) {
    try {
        const res = await $fetch<{ url: string }>(`/api/attachments/${item.id}/url`, { query: { download: '1' } });
        if (!res.url) throw new Error('empty');
        window.open(res.url, '_blank', 'noopener');
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function copyLink(item: AttachmentRecord) {
    try {
        const res = await $fetch<{ url: string }>(`/api/attachments/${item.id}/url`);
        if (!res.url) throw new Error('empty');
        await navigator.clipboard.writeText(res.url);
        success.value = t('common.copied');
        setTimeout(() => (success.value = ''), 2000);
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

function preview(item: AttachmentRecord) {
    if (!item.url) return;
    previewUrl.value = item.url;
}

const categoryLabel = (value: string) => {
    const found = ATTACHMENT_CATEGORIES.find((item) => item.value === value);
    return found ? found.label : value;
};

/** 按 MIME 选择图标，让列表在无缩略图时也能快速区分文件类型 */
function iconFor(mime: string): string {
    if (mime.startsWith('image/')) return 'file-image-outline';
    if (mime === 'application/pdf') return 'file-pdf-box';
    if (mime.includes('word')) return 'file-word-outline';
    if (mime.includes('excel') || mime.includes('spreadsheet')) return 'file-excel-outline';
    if (mime.includes('zip') || mime.includes('compressed')) return 'zip-box-outline';
    if (mime.startsWith('audio/')) return 'music-box-outline';
    if (mime.startsWith('video/')) return 'video-outline';
    return 'file-outline';
}
</script>

<template>
    <div class="space-y-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h1 class="text-2xl font-black tracking-tight">{{ t('attachments.title') }}</h1>
                <p class="text-faint mt-1 text-xs">{{ t('attachments.subtitle') }}</p>
            </div>
            <div class="flex items-center gap-2">
                <select v-model="uploadCategory" class="app-input !w-auto text-xs">
                    <option v-for="c in ATTACHMENT_CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
                </select>
                <button type="button" class="app-btn app-btn-primary" :disabled="!canUpload" @click="pickFile">
                    <AppIcon name="tray-arrow-up" :size="16" />
                    <span>{{ uploading ? t('attachments.uploading') : t('attachments.upload') }}</span>
                </button>
                <input ref="fileInput" type="file" multiple class="hidden" @change="onFileChange" />
            </div>
        </div>

        <div v-if="error" class="app-alert app-alert-danger">
            <AppIcon name="alert-outline" :size="16" />
            <span>{{ error }}</span>
        </div>
        <div v-if="success" class="app-alert app-alert-success">
            <AppIcon name="check-circle-outline" :size="16" />
            <span>{{ success }}</span>
        </div>

        <!-- 拖拽上传区 -->
        <div
            class="app-card flex flex-col items-center justify-center gap-2 border-2 border-dashed p-8 text-center transition-colors"
            :class="dragActive ? 'border-[color:var(--brand-500)] bg-[color:var(--brand-50)]' : ''"
            @dragover.prevent="dragActive = true"
            @dragleave.prevent="dragActive = false"
            @drop.prevent="onDrop"
        >
            <AppIcon name="cloud-upload-outline" :size="34" class="text-faint" />
            <p class="text-sm font-bold">{{ t('attachments.dropHint') }}</p>
            <p class="text-faint text-xs">{{ t('attachments.dropHintSub') }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <div class="relative flex-1 sm:max-w-xs">
                <AppIcon name="magnify" :size="15" class="text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                <input v-model="keyword" class="app-input pl-8 text-xs" :placeholder="t('attachments.searchPlaceholder')" />
            </div>
            <button
                v-for="c in [{ value: 'all', label: t('common.all') }, ...ATTACHMENT_CATEGORIES]"
                :key="c.value"
                type="button"
                class="app-chip transition-colors"
                :class="category === c.value ? 'app-chip-brand' : ''"
                @click="category = c.value"
            >
                {{ c.label }}
                <span v-if="c.value !== 'all' && categoryCounts.get(c.value)" class="ml-0.5 opacity-70">{{ categoryCounts.get(c.value) }}</span>
            </button>
            <span class="text-faint ml-auto text-xs">{{ summaryText }}</span>
        </div>

        <div v-if="stats.byCategory.length > 1" class="app-card p-4">
            <p class="text-xs font-bold">{{ t('attachments.usageTitle') }}</p>
            <div class="mt-3 space-y-2">
                <div v-for="row in stats.byCategory" :key="row.category" class="flex items-center gap-3">
                    <span class="text-faint w-20 shrink-0 text-[11px]">{{ categoryLabel(row.category) }}</span>
                    <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--surface-3)]">
                        <div class="h-full rounded-full bg-[color:var(--brand-500)]" :style="{ width: usageWidth(row.bytes) }" />
                    </div>
                    <span class="text-faint w-24 shrink-0 text-right text-[11px]">{{ formatBytes(row.bytes) }} · {{ row.count }}</span>
                </div>
            </div>
        </div>

        <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="i in 6" :key="i" class="app-skeleton h-28" />
        </div>

        <div v-else-if="attachments.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="item in attachments" :key="item.id" class="app-card app-card-hover flex flex-col gap-3 p-4">
                <div class="flex items-start gap-3">
                    <button
                        type="button"
                        class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[color:var(--surface-3)]"
                        :class="item.isImage && item.url ? 'cursor-zoom-in' : 'cursor-default'"
                        @click="item.isImage ? preview(item) : undefined"
                    >
                        <img v-if="item.isImage && item.url" :src="item.url" :alt="item.filename" class="h-full w-full object-cover" />
                        <AppIcon v-else :name="iconFor(item.mimeType)" :size="22" class="text-soft" />
                    </button>
                    <div class="min-w-0 flex-1">
                        <p class="truncate text-xs font-bold" :title="item.filename">{{ item.filename }}</p>
                        <p class="text-faint mt-1 text-[11px]">{{ formatBytes(item.size) }} · {{ categoryLabel(item.category) }}</p>
                        <p class="text-faint mt-0.5 text-[11px]">{{ formatDate(item.createdAt) }}</p>
                    </div>
                </div>
                <div class="app-divider flex items-center gap-3 pt-2 text-[11px]">
                    <a v-if="item.url" :href="item.url" target="_blank" rel="noopener" class="app-link">{{ t('common.viewDetail') }}</a>
                    <button type="button" class="app-link" @click="download(item)">{{ t('attachments.download') }}</button>
                    <button type="button" class="app-link" @click="copyLink(item)">{{ t('attachments.copyLink') }}</button>
                    <button type="button" class="app-link ml-auto text-[color:var(--danger)]" @click="remove(item)">{{ t('common.delete') }}</button>
                </div>
            </div>
        </div>

        <div v-else class="app-card flex flex-col items-center gap-2 p-12 text-center">
            <AppIcon name="folder-multiple-outline" :size="34" class="text-faint" />
            <p class="text-sm font-bold">{{ t('attachments.empty') }}</p>
            <p class="text-faint text-xs">{{ t('attachments.emptyHint') }}</p>
        </div>

        <div v-if="totalPages > 1" class="flex items-center justify-center gap-2">
            <button type="button" class="app-btn app-btn-outline !px-3" :disabled="page <= 1" @click="goPage(page - 1)">
                <AppIcon name="chevron-left" :size="16" />
            </button>
            <span class="text-xs">{{ page }} / {{ totalPages }}</span>
            <button type="button" class="app-btn app-btn-outline !px-3" :disabled="page >= totalPages" @click="goPage(page + 1)">
                <AppIcon name="chevron-right" :size="16" />
            </button>
        </div>

        <!-- 图片预览 -->
        <Teleport to="body">
            <div v-if="previewUrl" class="app-modal-backdrop" @click.self="previewUrl = ''">
                <div class="max-h-[85vh] max-w-[90vw]">
                    <img :src="previewUrl" alt="preview" class="max-h-[85vh] max-w-[90vw] rounded-xl object-contain" />
                </div>
                <button type="button" class="app-btn app-btn-soft absolute top-4 right-4" @click="previewUrl = ''">
                    <AppIcon name="close" :size="16" />
                </button>
            </div>
        </Teleport>
    </div>
</template>
