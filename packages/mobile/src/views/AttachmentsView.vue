<script setup lang="ts">
import { ATTACHMENT_CATEGORIES, formatBytes, formatDate, type AttachmentRecord } from '@commons/contract';
import { IonActionSheet, IonContent, IonHeader, IonRefresher, IonRefresherContent, IonSearchbar, IonTitle, IonToolbar } from '@ionic/vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, apiUrl, extractApiError, getToken } from '../api/auth';
import { pickFiles, uploadAttachment } from '../composables/useUpload';
import PageShell from './PageShell.vue';

const { t } = useI18n();

const items = ref<AttachmentRecord[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const uploading = ref(false);
const error = ref('');
const success = ref('');
const keyword = ref('');
const category = ref('all');
const showCategorySheet = ref(false);
const progress = ref(0);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const categoryLabel = computed(() => (category.value === 'all' ? t('common.all') : category.value));

const categoryActions = [
    { text: t('common.all'), handler: () => (category.value = 'all') },
    ...ATTACHMENT_CATEGORIES.map((item) => ({ text: item.label, handler: () => (category.value = item.value) })),
    { text: t('common.cancel'), role: 'cancel' },
];

async function load(reset = false) {
    if (reset) page.value = 1;
    loading.value = true;
    error.value = '';
    try {
        const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
        if (category.value !== 'all') query.set('category', category.value);
        if (keyword.value.trim()) query.set('keyword', keyword.value.trim());
        const data = await api<{ attachments: AttachmentRecord[]; total: number }>(`/api/attachments?${query.toString()}`);
        items.value = data.attachments;
        total.value = data.total;
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        loading.value = false;
    }
}

async function handleRefresh(event: CustomEvent) {
    await load(true);
    (event.target as HTMLIonRefresherElement).complete();
}

onMounted(() => load(true));

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void load(true), 300);
}

function changeCategory(value: string) {
    category.value = value;
    showCategorySheet.value = false;
    void load(true);
}

/** 从相册/文件系统选择并上传（原生走 Capacitor，浏览器走 input） */
async function pickAndUpload() {
    error.value = '';
    success.value = '';
    const files = await pickFiles({ accept: '*/*', multiple: true });
    if (!files.length) return;

    uploading.value = true;
    progress.value = 0;
    let done = 0;
    const failures: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        try {
            await uploadAttachment(file, category.value === 'all' ? 'other' : category.value, (percent) => {
                // 总体进度：已完成文件数 + 当前文件百分比
                progress.value = Math.round(((i + percent / 100) / files.length) * 100);
            });
            done += 1;
        } catch (e) {
            failures.push(`${file.name}：${extractApiError(e, t('common.error'))}`);
        }
    }
    uploading.value = false;
    progress.value = 0;

    if (done) {
        success.value = t('attachments.uploadedCount', { n: done });
        setTimeout(() => (success.value = ''), 3000);
        await load(true);
    }
    if (failures.length) error.value = failures.join('；');
}

async function remove(item: AttachmentRecord) {
    if (!confirm(t('attachments.deleteConfirm', { name: item.filename }))) return;
    try {
        await api(`/api/attachments/${item.id}`, { method: 'DELETE' });
        success.value = t('common.deleted');
        setTimeout(() => (success.value = ''), 2500);
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function openAttachment(item: AttachmentRecord) {
    try {
        const res = await api<{ url: string }>(`/api/attachments/${item.id}/url`);
        if (!res.url) throw new Error('empty');
        window.open(res.url, '_blank', 'noopener');
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

/** 图片缩略图：私有桶的预签名 URL 已由列表接口签发；令牌失效时回退到带鉴权的下载代理 */
function thumbUrl(item: AttachmentRecord): string {
    if (item.url) return item.url;
    const token = getToken();
    const base = `${apiUrl(`/api/attachments/${item.id}/raw`)}`;
    return token ? `${base}?t=${encodeURIComponent(token)}` : base;
}

const previewUrl = ref('');
function preview(item: AttachmentRecord) {
    if (item.isImage && item.url) previewUrl.value = item.url;
}
</script>

<template>
    <PageShell>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <ion-title class="!text-lg font-black">{{ t('attachments.title') }}</ion-title>
                <template v-slot:end>
                    <button type="button" class="app-btn app-btn-soft mr-2 !px-3 !py-1" :disabled="uploading" @click="pickAndUpload">
                        {{ uploading ? `${progress}%` : t('attachments.upload') }}
                    </button>
                </template>
            </ion-toolbar>
            <ion-toolbar class="px-2">
                <ion-searchbar v-model="keyword" :placeholder="t('attachments.searchPlaceholder')" :debounce="300" class="p-0 text-xs" @ion-input="onSearch" />
            </ion-toolbar>
            <div class="flex items-center gap-2 px-4 pb-2">
                <button type="button" class="app-chip app-chip-brand" @click="showCategorySheet = true">🗂 {{ categoryLabel }}</button>
                <span class="text-faint text-[11px]">{{ t('attachments.totalCount', { n: total }) }}</span>
            </div>
        </ion-header>

        <ion-content>
            <template v-slot:fixed>
                <ion-refresher @ion-refresh="handleRefresh">
                    <ion-refresher-content pulling-text="下拉刷新" refreshing-spinner="crescent" />
                </ion-refresher>
            </template>

            <div class="space-y-3 p-4">
                <div v-if="error" class="app-alert app-alert-danger text-[11px]">{{ error }}</div>
                <div v-if="success" class="app-alert app-alert-success text-[11px]">{{ success }}</div>

                <!-- 上传进度 -->
                <div v-if="uploading" class="app-card p-3">
                    <div class="flex items-center justify-between text-[11px]">
                        <span>{{ t('attachments.uploading') }}</span>
                        <span class="font-bold">{{ progress }}%</span>
                    </div>
                    <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-3)]">
                        <div class="h-full rounded-full bg-[color:var(--brand-500)] transition-all" :style="{ width: `${progress}%` }" />
                    </div>
                </div>

                <div v-if="loading && !items.length" class="space-y-2">
                    <div v-for="i in 4" :key="i" class="app-skeleton h-16" />
                </div>

                <div v-else-if="items.length" class="space-y-2">
                    <div v-for="item in items" :key="item.id" class="app-card flex items-center gap-3 p-3">
                        <button
                            type="button"
                            class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[color:var(--surface-3)]"
                            @click="preview(item)"
                        >
                            <img v-if="item.isImage" :src="thumbUrl(item)" :alt="item.filename" class="h-full w-full object-cover" />
                            <span v-else class="text-lg">📄</span>
                        </button>
                        <div class="min-w-0 flex-1" @click="preview(item)">
                            <p class="truncate text-xs font-bold">{{ item.filename }}</p>
                            <p class="text-faint mt-0.5 text-[10px]">{{ formatBytes(item.size) }} · {{ formatDate(item.createdAt) }}</p>
                        </div>
                        <div class="flex shrink-0 items-center gap-2">
                            <button type="button" class="app-btn app-btn-ghost !px-2 !py-1 !text-[11px]" @click="openAttachment(item)">
                                {{ t('common.viewDetail') }}
                            </button>
                            <button type="button" class="app-btn app-btn-ghost !px-2 !py-1 !text-[11px] text-[color:var(--danger)]" @click="remove(item)">
                                {{ t('common.delete') }}
                            </button>
                        </div>
                    </div>
                </div>

                <div v-else class="text-faint py-16 text-center text-xs">
                    <p class="mb-2 text-3xl">📎</p>
                    <p class="font-bold">{{ t('attachments.empty') }}</p>
                    <p class="mt-1">{{ t('attachments.emptyHint') }}</p>
                </div>

                <!-- 分页 -->
                <div v-if="totalPages > 1" class="flex items-center justify-center gap-3 pt-2 text-xs">
                    <button
                        type="button"
                        class="app-btn app-btn-outline !px-3 !py-1"
                        :disabled="page <= 1"
                        @click="
                            page -= 1;
                            load();
                        "
                    >
                        ‹
                    </button>
                    <span>{{ page }} / {{ totalPages }}</span>
                    <button
                        type="button"
                        class="app-btn app-btn-outline !px-3 !py-1"
                        :disabled="page >= totalPages"
                        @click="
                            page += 1;
                            load();
                        "
                    >
                        ›
                    </button>
                </div>
            </div>
        </ion-content>

        <ion-action-sheet :is-open="showCategorySheet" :header="t('attachments.title')" :buttons="categoryActions" @did-dismiss="showCategorySheet = false" />

        <!-- 图片预览 -->
        <div v-if="previewUrl" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" @click="previewUrl = ''">
            <img :src="previewUrl" alt="preview" class="max-h-full max-w-full rounded-xl object-contain" />
        </div>
    </PageShell>
</template>
