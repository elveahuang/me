<script setup lang="ts">
import { extractApiError, formatBytes } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

interface StorageConfigItem {
    id: string;
    name: string;
    provider: string;
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyIdPreview: string;
    hasCredentials: boolean;
    forcePathStyle: boolean;
    publicBaseUrl: string;
    prefix: string;
    maxFileSizeMb: number;
    allowedMimeTypes: string[];
    enabled: boolean;
    isDefault: boolean;
    createdAt: string;
    /** 该存储下的附件数量与占用（列表接口附带） */
    attachmentCount?: number;
    attachmentBytes?: number;
}

const { t } = useI18n();

const configs = ref<StorageConfigItem[]>([]);
const loading = ref(false);
const error = ref('');
const success = ref('');
const editing = ref<Partial<StorageConfigItem> | null>(null);
const saving = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);

const form = reactive({
    name: '',
    provider: 's3',
    endpoint: '',
    region: 'us-east-1',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: true,
    publicBaseUrl: '',
    prefix: 'uploads',
    maxFileSizeMb: 20,
    allowedMimeTypesText: '',
    enabled: true,
    isDefault: false,
});

async function load() {
    loading.value = true;
    error.value = '';
    try {
        configs.value = await $fetch<StorageConfigItem[]>('/api/admin/storage');
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

/** RustFS 一键填充：默认端口 9000、path-style、单区域 */
function fillRustFsPreset() {
    Object.assign(form, {
        name: form.name || 'RustFS',
        provider: 's3',
        region: form.region || 'us-east-1',
        forcePathStyle: true,
        prefix: form.prefix || 'uploads',
    });
    success.value = t('storage.rustfsHint');
}

function openCreate() {
    editing.value = {};
    Object.assign(form, {
        name: '',
        provider: 's3',
        endpoint: 'http://127.0.0.1:9000',
        region: 'us-east-1',
        bucket: '',
        accessKeyId: '',
        secretAccessKey: '',
        forcePathStyle: true,
        publicBaseUrl: '',
        prefix: 'uploads',
        maxFileSizeMb: 20,
        allowedMimeTypesText: '',
        enabled: true,
        isDefault: configs.value.length === 0,
    });
    testResult.value = null;
    error.value = '';
}

function openEdit(item: StorageConfigItem) {
    editing.value = item;
    Object.assign(form, {
        name: item.name,
        provider: item.provider,
        endpoint: item.endpoint,
        region: item.region,
        bucket: item.bucket,
        accessKeyId: item.accessKeyIdPreview ? '' : '',
        secretAccessKey: '',
        forcePathStyle: item.forcePathStyle,
        publicBaseUrl: item.publicBaseUrl,
        prefix: item.prefix,
        maxFileSizeMb: item.maxFileSizeMb,
        allowedMimeTypesText: (item.allowedMimeTypes ?? []).join('\n'),
        enabled: item.enabled,
        isDefault: item.isDefault,
    });
    testResult.value = null;
    error.value = '';
}

function buildBody() {
    return {
        name: form.name.trim(),
        provider: form.provider,
        endpoint: form.endpoint.trim(),
        region: form.region.trim() || 'us-east-1',
        bucket: form.bucket.trim(),
        // 编辑时留空即保持原密钥（服务端以掩码占位符识别）
        ...(form.accessKeyId ? { accessKeyId: form.accessKeyId } : {}),
        ...(form.secretAccessKey ? { secretAccessKey: form.secretAccessKey } : {}),
        forcePathStyle: form.forcePathStyle,
        publicBaseUrl: form.publicBaseUrl.trim(),
        prefix: form.prefix.trim() || 'uploads',
        maxFileSizeMb: Number(form.maxFileSizeMb) || 20,
        allowedMimeTypes: form.allowedMimeTypesText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        enabled: form.enabled,
        isDefault: form.isDefault,
    };
}

async function save() {
    error.value = '';
    success.value = '';
    if (!form.name.trim()) {
        error.value = t('storage.name') + ' / ' + t('common.error');
        return;
    }
    if (!form.bucket.trim()) {
        error.value = t('storage.bucket') + ' / ' + t('common.error');
        return;
    }
    saving.value = true;
    try {
        const body = buildBody();
        if (editing.value?.id) {
            await $fetch(`/api/admin/storage/${editing.value.id}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/storage', { method: 'POST', body });
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

async function testConnection() {
    if (!editing.value?.id) {
        error.value = '请先保存后再测试连接';
        return;
    }
    testing.value = true;
    testResult.value = null;
    try {
        const body = buildBody();
        const res = await $fetch<{ ok: boolean; message: string }>(`/api/admin/storage/${editing.value.id}/test`, { method: 'POST', body });
        testResult.value = res;
    } catch (e) {
        testResult.value = { ok: false, message: extractApiError(e, t('common.error')) };
    } finally {
        testing.value = false;
    }
}

async function toggleDefault(item: StorageConfigItem) {
    try {
        await $fetch(`/api/admin/storage/${item.id}`, { method: 'PATCH', body: { isDefault: true } });
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function remove(item: StorageConfigItem) {
    if (!confirm(t('storage.deleteConfirm', { name: item.name }))) return;
    try {
        await $fetch(`/api/admin/storage/${item.id}`, { method: 'DELETE' });
        success.value = t('common.deleted');
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

// 附件总览（与存储配置同页展示，便于对照存储占用）
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

async function loadAttachments() {
    try {
        const res = await $fetch<{ items: AdminAttachmentRow[]; total: number; totalBytes: number }>('/api/admin/attachments', {
            query: { page: attPage.value, pageSize: attPageSize, keyword: attKeyword.value || undefined },
        });
        att.value = res.items;
        attTotal.value = res.total;
        attBytes.value = res.totalBytes;
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
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
    if (successTimer) clearTimeout(successTimer);
});

/** 成功提示自动消失；集中管理便于卸载时清理 */
let successTimer: ReturnType<typeof setTimeout> | null = null;
function flashSuccess(text: string, ms = 2000) {
    success.value = text;
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => (success.value = ''), ms);
}

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
        await Promise.all([loadAttachments(), load()]);
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
</script>

<template>
    <div class="space-y-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">{{ t('storage.title') }}</h1>
                <p class="mt-1 text-xs text-gray-400">{{ t('storage.subtitle') }}</p>
            </div>
            <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">
                {{ t('storage.addConfig') }}
            </button>
        </div>

        <div v-if="error" class="rounded-xl bg-red-50 p-3 text-sm text-red-600">{{ error }}</div>
        <div v-if="success" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{{ success }}</div>

        <!-- 配置列表 -->
        <div v-if="loading" class="space-y-3">
            <div v-for="i in 2" :key="i" class="h-20 animate-pulse rounded-2xl bg-white" />
        </div>

        <div v-else-if="configs.length" class="space-y-3">
            <div v-for="c in configs" :key="c.id" class="rounded-2xl bg-white p-5 shadow-sm">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-sm font-bold text-gray-800">{{ c.name }}</h3>
                            <span v-if="c.isDefault" class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">默认</span>
                            <span
                                :class="c.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'"
                                class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                            >
                                {{ c.enabled ? t('common.enabled') : t('common.disabled') }}
                            </span>
                            <span v-if="c.forcePathStyle" class="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">path-style</span>
                        </div>
                        <p class="mt-1.5 font-mono text-xs text-gray-500">{{ c.endpoint }} / {{ c.bucket }} · {{ c.region }}</p>
                        <p class="mt-1 text-[11px] text-gray-400">
                            {{ c.hasCredentials ? c.accessKeyIdPreview : '⚠ 未配置密钥' }} · {{ c.prefix }}/ · ≤{{ c.maxFileSizeMb }}MB
                            <template v-if="c.attachmentCount">
                                · {{ c.attachmentCount }} {{ t('storage.attFilesUnit') }} / {{ formatBytes(c.attachmentBytes) }}
                            </template>
                        </p>
                    </div>
                    <div class="flex shrink-0 items-center gap-2 text-xs">
                        <button v-if="!c.isDefault" class="text-emerald-600 hover:underline" @click="toggleDefault(c)">设为默认</button>
                        <button class="text-emerald-600 hover:underline" @click="openEdit(c)">{{ t('common.edit') }}</button>
                        <button class="text-red-500 hover:underline" @click="remove(c)">{{ t('common.delete') }}</button>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="rounded-2xl bg-white p-12 text-center shadow-sm">
            <p class="text-sm font-bold text-gray-600">{{ t('storage.noConfig') }}</p>
            <p class="mt-1 text-xs text-gray-400">{{ t('storage.noConfigHint') }}</p>
            <p class="mt-3 font-mono text-[11px] text-gray-400">{{ t('storage.rustfsHint') }}</p>
        </div>

        <!-- 附件总览 -->
        <div class="rounded-2xl bg-white p-6 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 class="text-sm font-bold text-gray-700">{{ t('storage.attTitle') }}</h2>
                    <p class="mt-0.5 text-xs text-gray-400">{{ t('storage.attSubtitle') }}</p>
                </div>
                <div class="flex items-center gap-4 text-xs text-gray-500">
                    <span
                        >{{ t('storage.attTotal') }}: <b class="text-gray-700">{{ attTotal }}</b></span
                    >
                    <span
                        >{{ t('storage.attBytes') }}: <b class="text-gray-700">{{ formatBytes(attBytes) }}</b></span
                    >
                    <input
                        v-model="attKeyword"
                        :placeholder="t('attachments.searchPlaceholder')"
                        class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs"
                    />
                </div>
            </div>

            <div class="mt-4 overflow-x-auto">
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
                <button
                    class="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                    :disabled="attPage <= 1"
                    @click="
                        attPage -= 1;
                        loadAttachments();
                    "
                >
                    上一页
                </button>
                <span>{{ attPage }} / {{ Math.ceil(attTotal / attPageSize) }}</span>
                <button
                    class="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                    :disabled="attPage >= Math.ceil(attTotal / attPageSize)"
                    @click="
                        attPage += 1;
                        loadAttachments();
                    "
                >
                    下一页
                </button>
            </div>
        </div>

        <!-- 存储配置新增/编辑抽屉：与其余管理端模块统一从右侧滑出 -->
        <AdminDrawer
            :open="editing !== null"
            :title="editing?.id ? t('storage.editConfig') : t('storage.addConfig')"
            width-class="sm:max-w-2xl"
            @close="editing = null"
        >
            <div class="space-y-3">
                <div class="flex justify-end">
                    <button class="text-xs text-emerald-600 hover:underline" type="button" @click="fillRustFsPreset">RustFS 预设</button>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                    <input v-model="form.name" :placeholder="t('storage.namePlaceholder')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    <input v-model="form.bucket" :placeholder="t('storage.bucket')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    <input
                        v-model="form.endpoint"
                        :placeholder="t('storage.endpointPlaceholder')"
                        class="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs sm:col-span-2"
                    />
                    <input v-model="form.region" :placeholder="t('storage.region')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    <input v-model="form.prefix" :placeholder="t('storage.prefix')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    <input
                        v-model="form.accessKeyId"
                        :placeholder="t('storage.accessKeyId')"
                        class="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    />
                    <input
                        v-model="form.secretAccessKey"
                        type="password"
                        :placeholder="t('storage.secretKeepHint')"
                        class="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    />
                    <input
                        v-model="form.publicBaseUrl"
                        :placeholder="t('storage.publicBaseUrlHint')"
                        class="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs sm:col-span-2"
                    />
                    <label class="flex items-center gap-2 text-sm text-gray-600">
                        <input v-model="form.forcePathStyle" type="checkbox" />
                        <span>{{ t('storage.forcePathStyle') }}</span>
                    </label>
                    <label class="flex items-center gap-2 text-sm text-gray-600">
                        <input v-model="form.isDefault" type="checkbox" />
                        <span>{{ t('storage.isDefault') }}</span>
                    </label>
                    <div class="flex items-center gap-2">
                        <input
                            v-model.number="form.maxFileSizeMb"
                            type="number"
                            min="1"
                            max="2048"
                            class="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                        <span class="text-xs text-gray-500">{{ t('storage.maxFileSizeMb') }}</span>
                    </div>
                    <label class="flex items-center gap-2 text-sm text-gray-600">
                        <input v-model="form.enabled" type="checkbox" />
                        <span>{{ t('common.enabled') }}</span>
                    </label>
                </div>

                <div>
                    <textarea
                        v-model="form.allowedMimeTypesText"
                        rows="2"
                        :placeholder="t('storage.allowedMimeTypesHint')"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    />
                    <p class="mt-1 text-[11px] text-gray-400">{{ t('storage.allowedMimeTypesHint') }}</p>
                </div>

                <div v-if="testResult" :class="testResult.ok ? 'text-emerald-600' : 'text-red-500'" class="rounded-lg bg-gray-50 p-2 text-xs">
                    {{ testResult.ok ? '✓' : '✗' }} {{ testResult.message }}
                </div>
                <p v-if="error" class="text-xs text-red-600">{{ error }}</p>
            </div>

            <template #footer>
                <button
                    class="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    type="button"
                    :disabled="testing"
                    @click="testConnection"
                >
                    {{ testing ? t('storage.testing') : t('storage.testConnection') }}
                </button>
                <button class="rounded-lg bg-gray-100 px-4 py-1.5 text-sm" type="button" @click="editing = null">{{ t('common.cancel') }}</button>
                <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50" :disabled="saving" @click="save">
                    {{ saving ? t('common.loading') : t('common.save') }}
                </button>
            </template>
        </AdminDrawer>
    </div>
</template>
