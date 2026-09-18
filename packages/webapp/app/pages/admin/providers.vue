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
const editing = ref<Partial<ProviderItem> | null>(null);
const modelsText = ref('');
const testResult = ref<Record<string, string>>({});
const error = ref('');
const success = ref('');
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
    error.value = '';
    try {
        providers.value = await $fetch<ProviderItem[]>('/api/admin/providers');
    } catch (e) {
        providers.value = [];
        fail(e, t('adminForm.providerLoadFailed'));
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
            models: modelsText.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
        };
        if (editing.value?.id) {
            await $fetch(`/api/admin/providers/${editing.value.id}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/providers', { method: 'POST', body });
        }
        editing.value = null;
        success.value = t('adminForm.savedOk');
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
        const res = await $fetch<{ ok: boolean; message: string }>(`/api/admin/providers/${p.id}/test`, {
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
        await $fetch(`/api/admin/providers/${p.id}`, { method: 'PATCH', body: { enabled: !p.enabled } });
        await load();
    } catch (e) {
        fail(e, t('adminForm.providerToggleFailed'));
    }
}

async function remove(id: string) {
    if (!confirm(t('adminForm.providerDeleteConfirm'))) return;
    error.value = '';
    try {
        await $fetch(`/api/admin/providers/${id}`, { method: 'DELETE' });
        success.value = t('adminForm.deletedOk');
        await load();
    } catch (e) {
        fail(e, t('adminForm.deleteFailed'));
    }
}
</script>

<template>
    <div>
        <div v-if="error" class="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div v-if="success" class="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{{ success }}</div>
        <div class="mb-6 flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">{{ t('adminForm.providerTitle') }}</h1>
                <p class="mt-1 text-xs text-gray-400">{{ t('adminForm.providerSubtitle') }}</p>
            </div>
            <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">
                {{ t('adminForm.providerNew') }}
            </button>
        </div>

        <div v-if="editing !== null" class="mb-6 space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <div class="grid grid-cols-2 gap-3">
                <input v-model="form.name" :placeholder="t('adminForm.providerNamePlaceholder')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input
                    v-model="form.baseUrl"
                    :placeholder="t('adminForm.providerBaseUrlPlaceholder')"
                    class="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
            </div>
            <input
                v-model="form.apiKey"
                :placeholder="
                    editing.id ? t('adminForm.providerApiKeyKeep', { mask: form.apiKey || t('adminForm.providerApiKeyUnset') }) : t('adminForm.providerApiKey')
                "
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
                v-model="modelsText"
                rows="3"
                :placeholder="t('adminForm.providerModelsPlaceholder')"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
            />
            <div class="flex items-center gap-4 text-sm text-gray-600">
                <label class="flex items-center gap-1"><input v-model="form.enabled" type="checkbox" /> {{ t('adminForm.enable') }}</label>
                <label class="flex items-center gap-1"><input v-model="form.isDefault" type="checkbox" /> {{ t('adminForm.providerIsDefault') }}</label>
            </div>
            <div class="flex gap-2">
                <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="save">{{ t('adminForm.save') }}</button>
                <button class="rounded-lg bg-gray-100 px-4 py-1.5 text-sm" @click="editing = null">{{ t('adminForm.cancel') }}</button>
            </div>
        </div>

        <table class="w-full rounded-2xl bg-white text-sm shadow-sm">
            <thead class="text-left text-gray-400">
                <tr>
                    <th class="p-4">{{ t('adminForm.provider') }}</th>
                    <th class="p-4">Base URL</th>
                    <th class="p-4">API Key</th>
                    <th class="p-4">{{ t('adminForm.providerModelCount') }}</th>
                    <th class="p-4">{{ t('adminForm.status') }}</th>
                    <th class="p-4">{{ t('adminForm.actions') }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="p in providers" :key="p.id" class="border-t border-gray-100">
                    <td class="p-4">
                        <p class="font-medium text-gray-800">
                            {{ p.name }}
                            <span v-if="p.isDefault" class="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-600">
                                {{ t('adminForm.providerDefaultBadge') }}
                            </span>
                        </p>
                        <p class="mt-1 text-xs text-gray-400">{{ testResult[p.id] }}</p>
                    </td>
                    <td class="p-4 font-mono text-xs text-gray-500">{{ p.baseUrl }}</td>
                    <td class="p-4 font-mono text-xs text-gray-500">{{ p.apiKey || t('adminForm.providerApiKeyUnset') }}</td>
                    <td class="p-4 text-gray-500">{{ p.models?.length ?? 0 }}</td>
                    <td class="p-4">
                        <button :class="p.enabled ? 'text-green-600' : 'text-gray-400'" @click="toggle(p)">
                            {{ p.enabled ? t('common.enabled') : t('common.disabled') }}
                        </button>
                    </td>
                    <td class="space-x-2 p-4">
                        <button class="text-blue-500 hover:underline" @click="test(p)">{{ t('adminForm.providerTest') }}</button>
                        <button class="text-green-600 hover:underline" @click="openEdit(p)">{{ t('adminForm.edit') }}</button>
                        <button class="text-red-500 hover:underline" @click="remove(p.id)">{{ t('adminForm.delete') }}</button>
                    </td>
                </tr>
                <tr v-if="!providers.length">
                    <td colspan="6" class="p-8 text-center text-gray-400">{{ t('adminForm.providerEmpty') }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
