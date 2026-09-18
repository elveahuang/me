<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

interface ToolItem {
    id: string;
    name: string;
    description: string;
    type: string;
    config: Record<string, unknown>;
    enabled: boolean;
}

/** 占位符里的示例属于代码片段，不参与翻译（放进 locale 会被 vue-i18n 当成插值语法报错） */
const PARAMS_SAMPLE = '[{"name":"city","type":"string","description":"City","required":true}]';
const HEADERS_SAMPLE = '{"Authorization": "Bearer xxx"}';

const tools = ref<ToolItem[]>([]);
const editing = ref<Partial<ToolItem> | null>(null);
const formError = ref('');
/** 列表级错误（切换/删除失败时提示，避免静默） */
const listError = ref('');
/** 保存中标记：防止重复提交并在请求期间禁用按钮 */
const saving = ref(false);

const form = reactive({
    name: '',
    description: '',
    type: 'builtin_time',
    enabled: true,
    url: '',
    method: 'GET',
    headersText: '{}',
    parametersText: '[]',
    bodyTemplate: '',
});

async function load() {
    try {
        tools.value = await $fetch<ToolItem[]>('/api/admin/tools');
        listError.value = '';
    } catch (e) {
        tools.value = [];
        listError.value = extractApiError(e, t('adminForm.loadFailed'));
    }
}

onMounted(load);

function buildConfig(): Record<string, unknown> | null {
    if (form.type !== 'http') return {};
    let headers: Record<string, string> = {};
    let parameters: unknown[] = [];
    try {
        headers = JSON.parse(form.headersText || '{}');
        parameters = JSON.parse(form.parametersText || '[]');
    } catch {
        formError.value = t('adminForm.toolInvalidJson');
        return null;
    }
    return {
        url: form.url,
        method: form.method,
        headers,
        parameters,
        ...(form.bodyTemplate ? { bodyTemplate: form.bodyTemplate } : {}),
    };
}

function openCreate() {
    editing.value = {};
    Object.assign(form, {
        name: '',
        description: '',
        type: 'builtin_time',
        enabled: true,
        url: '',
        method: 'GET',
        headersText: '{}',
        parametersText: '[]',
        bodyTemplate: '',
    });
    formError.value = '';
}

function openEdit(tool: ToolItem) {
    editing.value = tool;
    const config = (tool.config ?? {}) as {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        bodyTemplate?: string;
        parameters?: unknown[];
    };
    Object.assign(form, {
        name: tool.name,
        description: tool.description,
        type: tool.type,
        enabled: tool.enabled,
        url: config.url ?? '',
        method: config.method ?? 'GET',
        headersText: JSON.stringify(config.headers ?? {}, null, 2),
        parametersText: JSON.stringify(config.parameters ?? [], null, 2),
        bodyTemplate: config.bodyTemplate ?? '',
    });
    formError.value = '';
}

async function save() {
    if (saving.value) return;
    formError.value = '';
    const config = buildConfig();
    if (config === null) return;
    if (!form.name.trim()) {
        formError.value = t('adminForm.requiredName');
        return;
    }
    const body = {
        name: form.name,
        description: form.description,
        type: form.type,
        enabled: form.enabled,
        config,
    };
    saving.value = true;
    try {
        if (editing.value?.id) {
            await $fetch(`/api/admin/tools/${editing.value.id}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/tools', { method: 'POST', body });
        }
        editing.value = null;
        await load();
    } catch (e) {
        formError.value = extractApiError(e, t('adminForm.saveFailed'));
    } finally {
        saving.value = false;
    }
}

async function toggle(tool: ToolItem) {
    listError.value = '';
    try {
        await $fetch(`/api/admin/tools/${tool.id}`, { method: 'PATCH', body: { enabled: !tool.enabled } });
        await load();
    } catch (e) {
        listError.value = extractApiError(e, t('adminForm.operationFailed'));
    }
}

async function remove(id: string) {
    if (!confirm(t('adminForm.toolDeleteConfirm'))) return;
    listError.value = '';
    try {
        await $fetch(`/api/admin/tools/${id}`, { method: 'DELETE' });
        await load();
    } catch (e) {
        listError.value = extractApiError(e, t('adminForm.deleteFailed'));
    }
}
</script>

<template>
    <div>
        <div v-if="listError" class="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
            {{ listError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div class="mb-6 flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">{{ t('adminForm.toolTitle') }}</h1>
                <p class="mt-1 text-xs text-gray-400">
                    {{ t('adminForm.toolSubtitle') }}
                </p>
            </div>
            <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">
                {{ t('adminForm.toolNew') }}
            </button>
        </div>

        <div v-if="editing !== null" class="mb-6 space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <div class="grid grid-cols-2 gap-3">
                <input v-model="form.name" :placeholder="t('adminForm.toolNamePlaceholder')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <select v-model="form.type" class="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option value="builtin_time">{{ t('adminForm.toolTypeBuiltin') }}</option>
                    <option value="http">{{ t('adminForm.toolTypeHttp') }}</option>
                </select>
            </div>
            <input v-model="form.description" :placeholder="t('adminForm.toolDescPlaceholder')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />

            <template v-if="form.type === 'http'">
                <div class="grid grid-cols-[6rem_1fr] gap-3">
                    <select v-model="form.method" class="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option>GET</option>
                        <option>POST</option>
                        <option>PUT</option>
                        <option>DELETE</option>
                    </select>
                    <input
                        v-model="form.url"
                        :placeholder="t('adminForm.toolUrlPlaceholder')"
                        class="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    />
                </div>
                <textarea
                    v-model="form.parametersText"
                    rows="4"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    :placeholder="`${t('adminForm.toolParamsLabel')}${PARAMS_SAMPLE}`"
                />
                <textarea
                    v-model="form.headersText"
                    rows="2"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    :placeholder="`${t('adminForm.toolHeadersLabel')}${HEADERS_SAMPLE}`"
                />
                <textarea
                    v-if="form.method !== 'GET'"
                    v-model="form.bodyTemplate"
                    rows="2"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    :placeholder="t('adminForm.toolBodyPlaceholder')"
                />
            </template>

            <label class="flex items-center gap-1 text-sm text-gray-600"> <input v-model="form.enabled" type="checkbox" /> {{ t('adminForm.enable') }} </label>
            <p v-if="formError" class="text-sm text-red-500">{{ formError }}</p>
            <div class="flex gap-2">
                <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50" :disabled="saving" @click="save">
                    {{ t('adminForm.save') }}
                </button>
                <button class="rounded-lg bg-gray-100 px-4 py-1.5 text-sm" :disabled="saving" @click="editing = null">{{ t('adminForm.cancel') }}</button>
            </div>
        </div>

        <table class="w-full rounded-2xl bg-white text-sm shadow-sm">
            <thead class="text-left text-gray-400">
                <tr>
                    <th class="p-4">Tool</th>
                    <th class="p-4">{{ t('adminForm.colType') }}</th>
                    <th class="p-4">{{ t('adminForm.status') }}</th>
                    <th class="p-4">{{ t('adminForm.actions') }}</th>
                </tr>
            </thead>
            <tbody>
                <!-- 循环变量命名为 tool 而非 t：避免遮蔽 i18n 的 t() 函数 -->
                <tr v-for="tool in tools" :key="tool.id" class="border-t border-gray-100">
                    <td class="p-4">
                        <p class="font-medium text-gray-800">{{ tool.name }}</p>
                        <p class="text-xs text-gray-400">{{ tool.description }}</p>
                    </td>
                    <td class="p-4">
                        <span :class="tool.type === 'http' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'" class="rounded-full px-2 py-0.5 text-xs">
                            {{ tool.type === 'http' ? 'HTTP' : t('adminForm.builtinTag') }}
                        </span>
                    </td>
                    <td class="p-4">
                        <button :class="tool.enabled ? 'text-green-600' : 'text-gray-400'" @click="toggle(tool)">
                            {{ tool.enabled ? t('common.enabled') : t('common.disabled') }}
                        </button>
                    </td>
                    <td class="space-x-2 p-4">
                        <button class="text-green-600 hover:underline" @click="openEdit(tool)">{{ t('adminForm.edit') }}</button>
                        <button class="text-red-500 hover:underline" @click="remove(tool.id)">{{ t('adminForm.delete') }}</button>
                    </td>
                </tr>
                <tr v-if="!tools.length">
                    <td colspan="4" class="p-8 text-center text-gray-400">{{ t('adminForm.toolEmpty') }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
