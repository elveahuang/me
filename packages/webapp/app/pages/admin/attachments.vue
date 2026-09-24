<script setup lang="ts">
import { extractApiError, formatBytes } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

interface AdminAttachmentRow {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    category: string;
    createdAt: string;
    userName: string;
    userEmail: string;
    storageName: string;
    objectKey: string;
}

const att = ref<AdminAttachmentRow[]>([]);
const attTotal = ref(0);
const attBytes = ref(0);
const attKeyword = ref('');
const attPage = ref(1);
const attPageSize = 10;
const loading = ref(true); // 首帧即加载态：数据要等挂载后的请求，初值 false 会让「暂无…」空态先闪一帧，SSR 首屏更是直接把空态发给用户
const error = ref('');
const { success, flashSuccess } = useFlashSuccess();

/** 翻页与搜索防抖共用同一请求，旧请求后回会把上一个条件的结果写回来 */
let loadSeq = 0;

async function loadAttachments() {
    const seq = ++loadSeq;
    loading.value = true;
    error.value = '';
    try {
        const res = await $fetch<{ items: AdminAttachmentRow[]; total: number; totalBytes: number }>('/api/admin/attachments', {
            query: { page: attPage.value, pageSize: attPageSize, keyword: attKeyword.value || undefined },
        });
        if (seq !== loadSeq) return;
        att.value = res.items;
        attTotal.value = res.total;
        attBytes.value = res.totalBytes;
    } catch (e) {
        if (seq !== loadSeq) return;
        att.value = [];
        attTotal.value = 0;
        attBytes.value = 0;
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        if (seq === loadSeq) loading.value = false;
    }
}

onMounted(loadAttachments);

/** 附件搜索防抖；卸载时清理，避免组件销毁后仍触发请求 */
let attTimer: ReturnType<typeof setTimeout> | null = null;
watch(attKeyword, () => {
    if (attTimer) clearTimeout(attTimer);
    attTimer = setTimeout(() => {
        attPage.value = 1;
        loadAttachments();
    }, 300);
});

onBeforeUnmount(() => {
    if (attTimer) clearTimeout(attTimer);
});

async function removeAttachment(row: AdminAttachmentRow) {
    if (!confirm(t('storage.attDeleteConfirm', { name: row.filename }))) return;
    error.value = '';
    try {
        const res = await $fetch<{ storageDeleted: boolean; storageError?: string }>(`/api/admin/attachments/${encodeURIComponent(row.id)}`, {
            method: 'DELETE',
        });
        // storageError 可能为空：仅在确有错误时拼接，避免出现「存储清理失败：undefined」
        if (res.storageDeleted) {
            flashSuccess(t('common.deleted'));
        } else {
            flashSuccess(`${t('common.deleted')}（${t('storage.attDeletePartial')}${res.storageError || t('common.none')}）`);
        }
        await loadAttachments();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function copyKey(key: string) {
    try {
        await navigator.clipboard.writeText(key);
        flashSuccess(t('common.copied'));
    } catch {
        // 剪贴板不可用时静默忽略
    }
}

function goPage(next: number) {
    attPage.value = next;
    loadAttachments();
}
</script>

<template>
    <div class="space-y-6">
        <div class="app-page-header !mb-0">
            <div>
                <h1 class="app-page-title text-strong">{{ t('storage.attTitle') }}</h1>
                <p class="app-page-subtitle">{{ t('storage.attSubtitle') }}</p>
            </div>
        </div>

        <div v-if="error" class="app-alert app-alert-danger">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="loadAttachments">{{ t('common.retry') }}</button>
        </div>
        <div v-if="success" class="app-alert app-alert-success">{{ success }}</div>

        <div class="app-card p-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="text-muted-2 flex items-center gap-4 text-xs">
                    <span
                        >{{ t('storage.attTotal') }}: <b class="text-strong font-medium tabular-nums">{{ attTotal }}</b></span
                    >
                    <span
                        >{{ t('storage.attBytes') }}: <b class="text-strong font-medium tabular-nums">{{ formatBytes(attBytes) }}</b></span
                    >
                </div>
                <input
                    v-model="attKeyword"
                    :placeholder="t('attachments.searchPlaceholder')"
                    :aria-label="t('attachments.searchPlaceholder')"
                    class="app-input !w-56 !py-1.5 !text-xs"
                />
            </div>

            <div v-if="loading" class="mt-4 space-y-2">
                <div v-for="i in 3" :key="i" class="app-skeleton h-12 !rounded-xl" />
            </div>

            <div v-else class="mt-4 overflow-x-auto">
                <table class="app-table">
                    <thead>
                        <tr>
                            <th>{{ t('adminForm.colFile') }}</th>
                            <th>{{ t('storage.attUploader') }}</th>
                            <th>{{ t('storage.attStorage') }}</th>
                            <th>{{ t('storage.attObjectKey') }}</th>
                            <th class="text-right">{{ t('common.actions') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in att" :key="row.id">
                            <td class="app-table-cell-wrap">
                                <p class="text-strong font-medium" :title="row.filename">{{ row.filename }}</p>
                                <p class="text-faint text-[11px]">{{ formatBytes(row.size) }} · {{ row.mimeType }}</p>
                            </td>
                            <td class="text-soft text-xs">
                                <p class="font-medium">{{ row.userName }}</p>
                                <p class="text-faint text-[11px]">{{ row.userEmail }}</p>
                            </td>
                            <td class="text-muted-2 text-xs">{{ row.storageName }}</td>
                            <td>
                                <button
                                    class="text-faint text-hover-brand max-w-[16rem] truncate font-mono text-[11px]"
                                    :title="row.objectKey"
                                    @click="copyKey(row.objectKey)"
                                >
                                    {{ row.objectKey }}
                                </button>
                            </td>
                            <td>
                                <div class="app-table-actions">
                                    <button class="app-btn app-btn-danger app-btn-sm" @click="removeAttachment(row)">{{ t('common.delete') }}</button>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="!att.length">
                            <td colspan="5" class="!whitespace-normal">
                                <div class="app-empty">
                                    <span class="app-empty-icon">📎</span>
                                    <p class="app-empty-title">{{ t('admin.tableEmpty') }}</p>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="attTotal > attPageSize" class="mt-3 flex items-center justify-end gap-2 text-xs">
                <button class="app-btn app-btn-outline app-btn-sm" :disabled="attPage <= 1" @click="goPage(attPage - 1)">{{ t('admin.prevPage') }}</button>
                <span class="text-muted-2 tabular-nums">{{ attPage }} / {{ Math.ceil(attTotal / attPageSize) }}</span>
                <button class="app-btn app-btn-outline app-btn-sm" :disabled="attPage >= Math.ceil(attTotal / attPageSize)" @click="goPage(attPage + 1)">
                    {{ t('admin.nextPage') }}
                </button>
            </div>
        </div>
    </div>
</template>
