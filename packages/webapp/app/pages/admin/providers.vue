<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

interface ProviderItem {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
    enabled: boolean;
    isDefault: boolean;
}

const providers = ref<ProviderItem[]>([]);
const loading = ref(true);
const editing = ref<Partial<ProviderItem> | null>(null);
const modelsText = ref('');
const testResult = ref<Record<string, string>>({});
const error = ref('');
const { success, flashSuccess } = useFlashSuccess();
const saving = ref(false);

const form = reactive({
    name: '',
    baseUrl: '',
    apiKey: '',
    enabled: true,
    isDefault: false,
});

/** 失败提示统一走这里：本页所有请求都可能因网络或服务端校验失败 */
function fail(e: unknown, fallback = t('adminForm.operationFailed')) {
    success.value = '';
    error.value = extractApiError(e, fallback);
}

async function load() {
    loading.value = true;
    error.value = '';
    try {
        providers.value = await $fetch<ProviderItem[]>('/api/admin/providers');
    } catch (e) {
        providers.value = [];
        fail(e, t('adminForm.providerLoadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

function openCreate() {
    editing.value = {};
    Object.assign(form, { name: '', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', enabled: true, isDefault: false });
    modelsText.value = '';
    error.value = '';
}

function openEdit(p: ProviderItem) {
    editing.value = p;
    Object.assign(form, {
        name: p.name,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        enabled: p.enabled,
        isDefault: p.isDefault,
    });
    modelsText.value = (p.models ?? []).join('\n');
    error.value = '';
}

async function save() {
    if (saving.value) return;
    if (!form.name.trim()) {
        fail(new Error(t('adminForm.requiredName')));
        return;
    }
    if (!form.baseUrl.trim()) {
        fail(new Error(t('adminForm.needUrl')));
        return;
    }
    saving.value = true;
    error.value = '';
    try {
        const body = {
            ...form,
            name: form.name.trim(),
            baseUrl: form.baseUrl.trim(),
            models: modelsText.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
        };
        if (editing.value?.id) {
            await $fetch(`/api/admin/providers/${encodeURIComponent(editing.value.id)}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/providers', { method: 'POST', body });
        }
        editing.value = null;
        flashSuccess(t('adminForm.savedOk'));
        await load();
    } catch (e) {
        fail(e, t('adminForm.saveFailed'));
    } finally {
        saving.value = false;
    }
}

async function test(p: ProviderItem) {
    testResult.value[p.id] = t('adminForm.providerTesting');
    try {
        const res = await $fetch<{ ok: boolean; message: string }>(`/api/admin/providers/${encodeURIComponent(p.id)}/test`, {
            method: 'POST',
        });
        testResult.value[p.id] = res.message;
        await load();
    } catch (e) {
        // 测试接口本身报错时也要给出结果，否则「测试中…」会永久停留
        testResult.value[p.id] = extractApiError(e, t('adminForm.providerTestFailed'));
    }
}

async function toggle(p: ProviderItem) {
    error.value = '';
    try {
        await $fetch(`/api/admin/providers/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { enabled: !p.enabled } });
        await load();
    } catch (e) {
        fail(e, t('adminForm.providerToggleFailed'));
    }
}

async function remove(id: string) {
    if (!confirm(t('adminForm.providerDeleteConfirm'))) return;
    error.value = '';
    try {
        await $fetch(`/api/admin/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
        flashSuccess(t('adminForm.deletedOk'));
        await load();
    } catch (e) {
        fail(e, t('adminForm.deleteFailed'));
    }
}
</script>

<template>
    <div>
        <div v-if="error" class="app-alert app-alert-danger mb-4">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div v-if="success" class="app-alert app-alert-success mb-4">{{ success }}</div>
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('adminForm.providerTitle') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.providerSubtitle') }}</p>
            </div>
            <button class="app-btn app-btn-primary app-btn-sm" @click="openCreate">
                {{ t('adminForm.providerNew') }}
            </button>
        </div>

        <AdminDrawer :open="editing !== null" :title="editing?.id ? t('common.edit') : t('adminForm.providerNew')" @close="editing = null">
            <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <input
                        :aria-label="t('adminForm.providerNamePlaceholder')"
                        v-model="form.name"
                        :placeholder="t('adminForm.providerNamePlaceholder')"
                        class="app-input"
                    />
                    <input
                        :aria-label="t('adminForm.providerBaseUrlPlaceholder')"
                        v-model="form.baseUrl"
                        :placeholder="t('adminForm.providerBaseUrlPlaceholder')"
                        class="app-input"
                    />
                </div>
                <input
                    :aria-label="t('adminForm.providerApiKey')"
                    v-model="form.apiKey"
                    :placeholder="
                        editing?.id
                            ? t('adminForm.providerApiKeyKeep', { mask: form.apiKey || t('adminForm.providerApiKeyUnset') })
                            : t('adminForm.providerApiKey')
                    "
                    class="app-input"
                />
                <textarea
                    :aria-label="t('adminForm.providerModelsPlaceholder')"
                    v-model="modelsText"
                    rows="3"
                    :placeholder="t('adminForm.providerModelsPlaceholder')"
                    class="app-input !font-mono !text-xs"
                />
                <div class="text-soft flex items-center gap-4 text-sm">
                    <label class="flex items-center gap-1"
                        ><input v-model="form.enabled" type="checkbox" class="app-checkbox" /> {{ t('adminForm.enable') }}</label
                    >
                    <label class="flex items-center gap-1"
                        ><input v-model="form.isDefault" type="checkbox" class="app-checkbox" /> {{ t('adminForm.providerIsDefault') }}</label
                    >
                </div>
            </div>
            <template #footer>
                <button class="app-btn app-btn-ghost" :disabled="saving" @click="editing = null">{{ t('adminForm.cancel') }}</button>
                <button class="app-btn app-btn-primary app-btn-sm" :disabled="saving" @click="save">
                    {{ t('adminForm.save') }}
                </button>
            </template>
        </AdminDrawer>

        <div v-if="loading" class="space-y-2">
            <div v-for="i in 3" :key="i" class="app-skeleton h-16 !rounded-xl" />
        </div>
        <div v-else class="app-table-wrap">
            <table class="app-table">
                <thead>
                    <tr>
                        <th>{{ t('adminForm.provider') }}</th>
                        <th>Base URL</th>
                        <th>API Key</th>
                        <th>{{ t('adminForm.providerModelCount') }}</th>
                        <th>{{ t('adminForm.status') }}</th>
                        <th class="text-right">{{ t('adminForm.actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="p in providers" :key="p.id">
                        <td>
                            <p class="text-strong font-medium">
                                {{ p.name }}
                                <span v-if="p.isDefault" class="app-badge app-badge-success ml-1">{{ t('adminForm.providerDefaultBadge') }}</span>
                            </p>
                            <p v-if="testResult[p.id]" class="text-faint mt-0.5 text-xs">{{ testResult[p.id] }}</p>
                        </td>
                        <td class="app-table-cell-wrap text-muted-2 font-mono text-xs">{{ p.baseUrl }}</td>
                        <td class="app-table-cell-wrap text-muted-2 font-mono text-xs">{{ p.apiKey || t('adminForm.providerApiKeyUnset') }}</td>
                        <td class="text-muted-2 tabular-nums">{{ p.models?.length ?? 0 }}</td>
                        <td>
                            <button
                                type="button"
                                role="switch"
                                class="app-switch"
                                :aria-checked="p.enabled"
                                :aria-label="t('adminForm.enable')"
                                :title="p.enabled ? t('common.enabled') : t('common.disabled')"
                                @click="toggle(p)"
                            />
                        </td>
                        <td>
                            <div class="app-table-actions">
                                <button class="app-btn app-btn-ghost app-btn-sm" @click="test(p)">{{ t('adminForm.providerTest') }}</button>
                                <button class="app-btn app-btn-soft app-btn-sm" @click="openEdit(p)">{{ t('adminForm.edit') }}</button>
                                <button class="app-btn app-btn-danger app-btn-sm" @click="remove(p.id)">{{ t('adminForm.delete') }}</button>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="!providers.length">
                        <td colspan="6" class="!whitespace-normal">
                            <div class="app-empty">
                                <span class="app-empty-icon">🛰️</span>
                                <p class="app-empty-title">{{ t('adminForm.providerEmpty') }}</p>
                                <p class="app-empty-desc">{{ t('adminForm.providerSubtitle') }}</p>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
