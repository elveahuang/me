<script setup lang="ts">
import { extractApiError, formatBytes } from '@commons/contract';
import { useI18n } from 'vue-i18n';

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
const loading = ref(true);
const error = ref('');
const { success, flashSuccess, showPersistent } = useFlashSuccess();
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
        // 失败时清空配置列表：错误横幅与卡片列表是两条独立分支（v-if="error" / v-else-if="configs.length"），
        // 残留的旧卡片会把「接口挂了」读成「这些存储配置仍然有效」，其中可能已有被删掉或被改掉默认标记的项
        configs.value = [];
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
    showPersistent(t('storage.rustfsHint'));
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
        // 「首条配置自动设为默认」只在列表读取成功时成立：读取失败时 configs 是空的，
        // 若照此勾选，一次瞬时故障就会让管理员在后台已有配置的情况下顶掉当前默认后端
        isDefault: configs.value.length === 0 && !error.value,
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
        // 编辑态不回填密钥：留空即表示保持原密钥（见 buildBody 的条件展开）
        accessKeyId: '',
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
    if (saving.value) return;
    error.value = '';
    success.value = '';
    if (!form.name.trim()) {
        error.value = t('common.required', { field: t('storage.name') });
        return;
    }
    if (!form.bucket.trim()) {
        error.value = t('common.required', { field: t('storage.bucket') });
        return;
    }
    saving.value = true;
    try {
        const body = buildBody();
        if (editing.value?.id) {
            await $fetch(`/api/admin/storage/${encodeURIComponent(editing.value.id)}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/storage', { method: 'POST', body });
        }
        flashSuccess(t('common.saved'));
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
        error.value = t('adminForm.saveBeforeTest');
        return;
    }
    testing.value = true;
    testResult.value = null;
    try {
        const body = buildBody();
        const res = await $fetch<{ ok: boolean; message: string }>(`/api/admin/storage/${encodeURIComponent(editing.value.id)}/test`, { method: 'POST', body });
        testResult.value = res;
    } catch (e) {
        testResult.value = { ok: false, message: extractApiError(e, t('common.error')) };
    } finally {
        testing.value = false;
    }
}

async function toggleDefault(item: StorageConfigItem) {
    try {
        await $fetch(`/api/admin/storage/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { isDefault: true } });
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function remove(item: StorageConfigItem) {
    if (!confirm(t('storage.deleteConfirm', { name: item.name }))) return;
    try {
        await $fetch(`/api/admin/storage/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        flashSuccess(t('common.deleted'));
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}
</script>

<template>
    <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-faint text-xs">{{ t('settings.storageHint') }}</p>
            <button class="app-btn app-btn-primary app-btn-sm" @click="openCreate">
                {{ t('storage.addConfig') }}
            </button>
        </div>

        <div v-if="error" class="app-alert app-alert-danger">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div v-if="success" class="app-alert app-alert-success">{{ success }}</div>

        <div v-if="loading" class="space-y-3">
            <div v-for="i in 2" :key="i" class="app-skeleton h-20 !rounded-2xl" />
        </div>

        <div v-else-if="configs.length" class="space-y-3">
            <div v-for="c in configs" :key="c.id" class="app-card p-5">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-strong text-sm font-bold">{{ c.name }}</h3>
                            <span v-if="c.isDefault" class="app-chip app-chip-brand">{{ t('adminForm.storageDefaultChip') }}</span>
                            <span :class="c.enabled ? 'app-badge-success' : 'app-badge-neutral'" class="app-badge">
                                {{ c.enabled ? t('common.enabled') : t('common.disabled') }}
                            </span>
                            <span v-if="c.forcePathStyle" class="app-badge app-badge-info">path-style</span>
                        </div>
                        <p class="text-muted-2 mt-1.5 font-mono text-xs">{{ c.endpoint }} / {{ c.bucket }} · {{ c.region }}</p>
                        <p class="text-faint mt-1 text-[11px]">
                            {{ c.hasCredentials ? c.accessKeyIdPreview : t('adminForm.storageNoCredentials') }} · {{ c.prefix }}/ · ≤{{ c.maxFileSizeMb }}MB
                            <template v-if="c.attachmentCount">
                                · {{ c.attachmentCount }} {{ t('storage.attFilesUnit') }} / {{ formatBytes(c.attachmentBytes) }}
                            </template>
                        </p>
                    </div>
                    <div class="flex shrink-0 items-center gap-2 text-xs">
                        <button v-if="!c.isDefault" class="app-link" @click="toggleDefault(c)">{{ t('adminForm.storageSetDefault') }}</button>
                        <button class="app-link" @click="openEdit(c)">{{ t('common.edit') }}</button>
                        <button class="text-[color:var(--danger)] hover:underline" @click="remove(c)">{{ t('common.delete') }}</button>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="app-card app-empty">
            <span class="app-empty-icon">🗄️</span>
            <p class="app-empty-title">{{ t('storage.noConfig') }}</p>
            <p class="app-empty-desc">{{ t('storage.noConfigHint') }}</p>
            <p class="text-faint mt-3 font-mono text-[11px]">{{ t('storage.rustfsHint') }}</p>
        </div>

        <!-- 存储配置新增/编辑抽屉 -->
        <AdminDrawer
            :open="editing !== null"
            :title="editing?.id ? t('storage.editConfig') : t('storage.addConfig')"
            width-class="sm:max-w-2xl"
            @close="editing = null"
        >
            <div class="space-y-3">
                <div class="flex justify-end">
                    <button class="app-link text-xs" type="button" @click="fillRustFsPreset">{{ t('adminForm.storageRustfsPreset') }}</button>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                    <input :aria-label="t('storage.name')" v-model="form.name" :placeholder="t('storage.namePlaceholder')" class="app-input" />
                    <input :aria-label="t('storage.bucket')" v-model="form.bucket" :placeholder="t('storage.bucket')" class="app-input" />
                    <input
                        :aria-label="t('storage.endpoint')"
                        v-model="form.endpoint"
                        :placeholder="t('storage.endpointPlaceholder')"
                        class="app-input !font-mono !text-xs sm:col-span-2"
                    />
                    <input :aria-label="t('storage.region')" v-model="form.region" :placeholder="t('storage.region')" class="app-input" />
                    <input :aria-label="t('storage.prefix')" v-model="form.prefix" :placeholder="t('storage.prefix')" class="app-input" />
                    <input
                        :aria-label="t('storage.accessKeyId')"
                        v-model="form.accessKeyId"
                        :placeholder="t('storage.accessKeyId')"
                        class="app-input !font-mono !text-xs"
                    />
                    <input
                        :aria-label="t('storage.secretAccessKey')"
                        v-model="form.secretAccessKey"
                        type="password"
                        :placeholder="t('storage.secretKeepHint')"
                        class="app-input !font-mono !text-xs"
                    />
                    <input
                        :aria-label="t('storage.publicBaseUrl')"
                        v-model="form.publicBaseUrl"
                        :placeholder="t('storage.publicBaseUrlHint')"
                        class="app-input !font-mono !text-xs sm:col-span-2"
                    />
                    <label class="text-soft flex items-center gap-2 text-sm">
                        <input v-model="form.forcePathStyle" type="checkbox" class="app-checkbox" />
                        <span>{{ t('storage.forcePathStyle') }}</span>
                    </label>
                    <label class="text-soft flex items-center gap-2 text-sm">
                        <input v-model="form.isDefault" type="checkbox" class="app-checkbox" />
                        <span>{{ t('storage.isDefault') }}</span>
                    </label>
                    <div class="flex items-center gap-2">
                        <input
                            v-model.number="form.maxFileSizeMb"
                            type="number"
                            min="1"
                            max="2047"
                            :aria-label="t('storage.maxFileSizeMb')"
                            class="app-input !w-24"
                        />
                        <span class="text-muted-2 text-xs">{{ t('storage.maxFileSizeMb') }}</span>
                    </div>
                    <label class="text-soft flex items-center gap-2 text-sm">
                        <input v-model="form.enabled" type="checkbox" class="app-checkbox" />
                        <span>{{ t('common.enabled') }}</span>
                    </label>
                </div>

                <div>
                    <textarea
                        :aria-label="t('storage.allowedMimeTypes')"
                        v-model="form.allowedMimeTypesText"
                        rows="2"
                        :placeholder="t('storage.allowedMimeTypesHint')"
                        class="app-input !font-mono !text-xs"
                    />
                    <p class="app-help">{{ t('storage.allowedMimeTypesHint') }}</p>
                </div>

                <div v-if="testResult" :class="testResult.ok ? 'app-alert-success' : 'app-alert-danger'" class="app-alert !text-xs">
                    {{ testResult.ok ? '✓' : '✗' }} {{ testResult.message }}
                </div>
                <p v-if="error" class="app-help-error text-xs">{{ error }}</p>
            </div>

            <template #footer>
                <button class="app-btn app-btn-outline" type="button" :disabled="testing" @click="testConnection">
                    {{ testing ? t('storage.testing') : t('storage.testConnection') }}
                </button>
                <button class="app-btn app-btn-ghost" type="button" @click="editing = null">{{ t('common.cancel') }}</button>
                <button class="app-btn app-btn-primary" :disabled="saving" @click="save">
                    {{ saving ? t('common.loading') : t('common.save') }}
                </button>
            </template>
        </AdminDrawer>
    </div>
</template>
