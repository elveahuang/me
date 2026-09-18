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
const loading = ref(false);
const error = ref('');
const success = ref('');

async function loadAttachments() {
    loading.value = true;
    error.value = '';
    try {
        const res = await $fetch<{ items: AdminAttachmentRow[]; total: number; totalBytes: number }>('/api/admin/attachments', {
            query: { page: attPage.value, pageSize: attPageSize, keyword: attKeyword.value || undefined },
        });
        att.value = res.items;
        attTotal.value = res.total;
        attBytes.value = res.totalBytes;
    } catch (e) {
        att.value = [];
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
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

/** 成功提示自动消失；集中管理便于卸载时清理 */
let successTimer: ReturnType<typeof setTimeout> | null = null;
function flashSuccess(text: string, ms = 2000) {
    success.value = text;
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => (success.value = ''), ms);
}

onBeforeUnmount(() => {
    if (attTimer) clearTimeout(attTimer);
    if (successTimer) clearTimeout(successTimer);
});

async function removeAttachment(row: AdminAttachmentRow) {
    if (!confirm(t('storage.attDeleteConfirm', { name: row.filename }))) return;
    error.value = '';
    try {
        const res = await $fetch<{ storageDeleted: boolean; storageError?: string }>(`/api/admin/attachments/${row.id}`, { method: 'DELETE' });
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
        <div>
            <h1 class="text-2xl font-bold text-gray-800">{{ t('storage.attTitle') }}</h1>
            <p class="mt-1 text-xs text-gray-400">{{ t('storage.attSubtitle') }}</p>
        </div>

        <div v-if="error" class="rounded-xl bg-red-50 p-3 text-sm text-red-600">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="loadAttachments">{{ t('common.retry') }}</button>
        </div>
        <div v-if="success" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{{ success }}</div>

        <div class="rounded-2xl bg-white p-6 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
                <div class="flex items-center gap-4">
                    <span
                        >{{ t('storage.attTotal') }}: <b class="text-gray-700">{{ attTotal }}</b></span
                    >
                    <span
                        >{{ t('storage.attBytes') }}: <b class="text-gray-700">{{ formatBytes(attBytes) }}</b></span
                    >
                </div>
                <input v-model="attKeyword" :placeholder="t('attachments.searchPlaceholder')" class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs" />
            </div>

            <div v-if="loading" class="mt-4 space-y-2">
                <div v-for="i in 3" :key="i" class="h-12 animate-pulse rounded-xl bg-gray-50" />
            </div>

            <div v-else class="mt-4 overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="text-left text-xs text-gray-400">
                        <tr>
                            <th class="py-2 pr-4">文件</th>
                            <th class="py-2 pr-4">{{ t('storage.attUploader') }}</th>
                            <th class="py-2 pr-4">{{ t('storage.attStorage') }}</th>
                            <th class="py-2 pr-4">{{ t('storage.attObjectKey') }}</th>
                            <th class="py-2">{{ t('common.actions') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in att" :key="row.id" class="border-t border-gray-100">
                            <td class="py-3 pr-4">
                                <p class="max-w-[14rem] truncate font-medium text-gray-800" :title="row.filename">{{ row.filename }}</p>
                                <p class="text-[11px] text-gray-400">{{ formatBytes(row.size) }} · {{ row.mimeType }}</p>
                            </td>
                            <td class="py-3 pr-4 text-xs text-gray-600">
                                <p class="font-medium">{{ row.userName }}</p>
                                <p class="text-[11px] text-gray-400">{{ row.userEmail }}</p>
                            </td>
                            <td class="py-3 pr-4 text-xs text-gray-500">{{ row.storageName }}</td>
                            <td class="py-3 pr-4">
                                <button
                                    class="max-w-[16rem] truncate font-mono text-[11px] text-gray-400 hover:text-emerald-600"
                                    :title="row.objectKey"
                                    @click="copyKey(row.objectKey)"
                                >
                                    {{ row.objectKey }}
                                </button>
                            </td>
                            <td class="py-3 text-xs">
                                <button class="text-red-500 hover:underline" @click="removeAttachment(row)">{{ t('common.delete') }}</button>
                            </td>
                        </tr>
                        <tr v-if="!att.length">
                            <td colspan="5" class="py-8 text-center text-xs text-gray-400">{{ t('admin.tableEmpty') }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="attTotal > attPageSize" class="mt-3 flex items-center justify-end gap-2 text-xs">
                <button class="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" :disabled="attPage <= 1" @click="goPage(attPage - 1)">
                    上一页
                </button>
                <span>{{ attPage }} / {{ Math.ceil(attTotal / attPageSize) }}</span>
                <button
                    class="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                    :disabled="attPage >= Math.ceil(attTotal / attPageSize)"
                    @click="goPage(attPage + 1)"
                >
                    下一页
                </button>
            </div>
        </div>
    </div>
</template>
