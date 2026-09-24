<script setup lang="ts">
import {
    ATTACHMENT_CATEGORIES,
    formatBytes,
    formatDate,
    presetText,
    type AttachmentRecord,
    type AttachmentsResponse,
    type PresetItem,
} from '@commons/contract';
import { IonActionSheet, IonContent, IonHeader, IonRefresher, IonRefresherContent, IonSearchbar, IonTitle, IonToolbar } from '@ionic/vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, apiUrl, extractApiError } from '../api/auth';
import { useDialog } from '../composables/useDialog';
import { useFlashSuccess } from '../composables/useFlashSuccess';
import { isNativeShell, pickFiles, uploadAttachment } from '../composables/useUpload';
import PageShell from './PageShell.vue';

const { t, locale } = useI18n();
const { confirmDialog } = useDialog();

/** 原生壳才提供「拍照/相册」入口，浏览器保留单文件选择器即可 */
const nativeShell = isNativeShell();

const items = ref<AttachmentRecord[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(true); // 首帧即加载态：数据要等 onMounted/onIonViewWillEnter 之后的请求，初值 false 会让「暂无…」空态先闪一帧
const uploading = ref(false);
const error = ref('');
const { success, flashSuccess } = useFlashSuccess(3000);
const keyword = ref('');
const category = ref('all');
const showCategorySheet = ref(false);
const progress = ref(0);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
/** 契约的分类展示名带中英两份，按当前语言取（英文界面不再露出中文枚举值） */
const categoryText = (item: PresetItem) => presetText(item, locale.value);
const categoryLabel = computed(() => {
    if (category.value === 'all') return t('common.all');
    const found = ATTACHMENT_CATEGORIES.find((item) => item.value === category.value);
    return found ? categoryText(found) : category.value;
});

/** 动作表文案要随语言切换响应更新，不能在 setup 里一次性构造 */
const categoryActions = computed(() => [
    { text: t('common.all'), handler: () => changeCategory('all') },
    ...ATTACHMENT_CATEGORIES.map((item) => ({ text: categoryText(item), handler: () => changeCategory(item.value) })),
    { text: t('common.cancel'), role: 'cancel' },
]);

/** 分类切换、搜索防抖与下拉刷新共用 load()：先发后回的旧响应会把上一个条件的列表写回来 */
let loadSeq = 0;

async function load(reset = false) {
    const seq = ++loadSeq;
    if (reset) page.value = 1;
    loading.value = true;
    error.value = '';
    try {
        const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
        if (category.value !== 'all') query.set('category', category.value);
        if (keyword.value.trim()) query.set('keyword', keyword.value.trim());
        const data = await api<AttachmentsResponse>(`/api/attachments?${query.toString()}`);
        if (seq !== loadSeq) return;
        items.value = data.attachments;
        total.value = data.total;
        // 删除末页最后一条后 page 会越界，钳回最后一页而不是停在越界的空页
        const maxPage = Math.max(1, Math.ceil(data.total / pageSize));
        if (page.value > maxPage) {
            page.value = maxPage;
            void load();
            return;
        }
    } catch (e) {
        // 失败时清空列表：否则列表走空态，"接口挂了"会被读成"还没有附件"
        items.value = [];
        error.value = extractApiError(e, t('common.error'));
    } finally {
        if (seq === loadSeq) loading.value = false;
    }
}

async function handleRefresh(event: CustomEvent) {
    await load(true);
    (event.target as HTMLIonRefresherElement).complete();
}

onMounted(() => load(true));

/** 搜索防抖；卸载时清理，避免页面销毁后仍触发请求 */
let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void load(true), 300);
}

onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer);
});

function changeCategory(value: string) {
    category.value = value;
    showCategorySheet.value = false;
    void load(true);
}

/** 选择文件并上传。原生壳下「拍照」走系统相机/相册，其余走文件选择器 */
async function pickAndUpload(source: 'file' | 'photo' = 'file') {
    error.value = '';
    success.value = '';
    let files: Awaited<ReturnType<typeof pickFiles>> = [];
    try {
        files = source === 'photo' ? await pickFiles({ source: 'photo', accept: 'image/*' }) : await pickFiles({ accept: '*/*', multiple: true });
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
        return;
    }
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
            failures.push(`${file.name}${t('common.colon')}${extractApiError(e, t('common.error'))}`);
        }
    }
    uploading.value = false;
    progress.value = 0;

    if (done) {
        flashSuccess(t('attachments.uploadedCount', { n: done }));
        await load(true);
    }
    if (failures.length) error.value = failures.join(t('common.listSep'));
}

async function remove(item: AttachmentRecord) {
    if (!(await confirmDialog(t('attachments.deleteConfirm', { name: item.filename })))) return;
    try {
        await api(`/api/attachments/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        flashSuccess(t('common.deleted'), 2500);
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function openAttachment(item: AttachmentRecord) {
    try {
        const res = await api<{ url: string }>(`/api/attachments/${encodeURIComponent(item.id)}/url`);
        if (!res.url) throw new Error('empty');
        window.open(res.url, '_blank', 'noopener');
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

/**
 * 图片缩略图：列表接口已经签发可访问地址，优先使用。
 * 地址缺失时只有浏览器能回退到下载代理（同源 cookie 鉴权）；原生壳的 <img> 带不上 Bearer，
 * 服务端也只读 Authorization 而不认 ?t= 查询参数，硬拼 token 只会得到 401 裂图。
 */
function thumbUrl(item: AttachmentRecord): string {
    if (item.url) return item.url;
    return nativeShell ? '' : apiUrl(`/api/attachments/${encodeURIComponent(item.id)}/raw`);
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
                    <button
                        v-if="nativeShell"
                        type="button"
                        class="app-btn app-btn-ghost mr-1 !px-2.5 !py-1"
                        :disabled="uploading"
                        :title="t('attachments.takePhoto')"
                        @click="pickAndUpload('photo')"
                    >
                        📷
                    </button>
                    <button type="button" class="app-btn app-btn-soft mr-2 !px-3 !py-1" :disabled="uploading" @click="pickAndUpload('file')">
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
                    <ion-refresher-content :pulling-text="t('common.pullToRefresh')" refreshing-spinner="crescent" />
                </ion-refresher>
            </template>

            <div class="space-y-3 p-4">
                <div v-if="error" class="app-alert app-alert-danger flex items-center justify-between gap-2 !text-[11px]">
                    <span>{{ error }}</span>
                    <button type="button" class="app-btn app-btn-soft shrink-0 !px-3 !py-1 !text-[10px]" @click="load(true)">
                        {{ t('common.retry') }}
                    </button>
                </div>
                <div v-if="success" class="app-alert app-alert-success !text-[11px]">{{ success }}</div>

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
                            <img v-if="item.isImage && thumbUrl(item)" :src="thumbUrl(item)" :alt="item.filename" class="h-full w-full object-cover" />
                            <span v-else class="text-lg">{{ item.isImage ? '🖼️' : '📄' }}</span>
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

                <div v-else-if="!error" class="text-faint py-16 text-center text-xs">
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
                        :aria-label="t('common.prevPage')"
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
                        :aria-label="t('common.nextPage')"
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

        <!-- 图片预览：声明了 aria-modal 的弹层必须自带出口——只靠 @click.self 点遮罩，图片铺满时没有可点的地方，
             读屏与键盘用户完全关不掉（Web 端同名预览已有 ✕ 按钮，这里补齐） -->
        <div v-if="previewUrl" class="app-modal-backdrop" role="dialog" aria-modal="true" :aria-label="t('attachments.preview')" @click.self="previewUrl = ''">
            <img :src="previewUrl" alt="preview" class="max-h-full max-w-full rounded-xl object-contain" />
            <button type="button" class="app-btn app-btn-soft absolute top-4 right-4" :aria-label="t('common.close')" @click="previewUrl = ''">✕</button>
        </div>
    </PageShell>
</template>
