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
        <div v-if="listError" class="app-alert app-alert-danger mb-4">
            {{ listError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('adminForm.toolTitle') }}</h1>
                <p class="app-page-subtitle">
                    {{ t('adminForm.toolSubtitle') }}
                </p>
            </div>
            <button class="app-btn app-btn-primary app-btn-sm" @click="openCreate">
                {{ t('adminForm.toolNew') }}
            </button>
        </div>

        <AdminDrawer
            :open="editing !== null"
            :title="editing?.id ? t('common.edit') : t('adminForm.toolNew')"
            width-class="sm:max-w-2xl"
            @close="editing = null"
        >
            <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <input v-model="form.name" :placeholder="t('adminForm.toolNamePlaceholder')" class="app-input" />
                    <select v-model="form.type" class="app-input">
                        <option value="builtin_time">{{ t('adminForm.toolTypeBuiltin') }}</option>
                        <option value="http">{{ t('adminForm.toolTypeHttp') }}</option>
                    </select>
                </div>
                <input v-model="form.description" :placeholder="t('adminForm.toolDescPlaceholder')" class="app-input" />

                <template v-if="form.type === 'http'">
                    <div class="grid grid-cols-[6rem_1fr] gap-3">
                        <select v-model="form.method" class="app-input">
                            <option>GET</option>
                            <option>POST</option>
                            <option>PUT</option>
                            <option>DELETE</option>
                        </select>
                        <input v-model="form.url" :placeholder="t('adminForm.toolUrlPlaceholder')" class="app-input !font-mono !text-xs" />
                    </div>
                    <textarea
                        v-model="form.parametersText"
                        rows="4"
                        class="app-input !font-mono !text-xs"
                        :placeholder="`${t('adminForm.toolParamsLabel')}${PARAMS_SAMPLE}`"
                    />
                    <textarea
                        v-model="form.headersText"
                        rows="2"
                        class="app-input !font-mono !text-xs"
                        :placeholder="`${t('adminForm.toolHeadersLabel')}${HEADERS_SAMPLE}`"
                    />
                    <textarea
                        v-if="form.method !== 'GET'"
                        v-model="form.bodyTemplate"
                        rows="2"
                        class="app-input !font-mono !text-xs"
                        :placeholder="t('adminForm.toolBodyPlaceholder')"
                    />
                </template>

                <label class="text-soft flex items-center gap-1.5 text-sm">
                    <input v-model="form.enabled" type="checkbox" class="app-checkbox" /> {{ t('adminForm.enable') }}
                </label>
                <p v-if="formError" class="app-help-error">{{ formError }}</p>
            </div>
            <template #footer>
                <button class="app-btn app-btn-ghost" :disabled="saving" @click="editing = null">{{ t('adminForm.cancel') }}</button>
                <button class="app-btn app-btn-primary app-btn-sm" :disabled="saving" @click="save">
                    {{ t('adminForm.save') }}
                </button>
            </template>
        </AdminDrawer>

        <div class="app-table-wrap">
            <table class="app-table">
                <thead>
                    <tr>
                        <th>Tool</th>
                        <th>{{ t('adminForm.colType') }}</th>
                        <th>{{ t('adminForm.status') }}</th>
                        <th class="text-right">{{ t('adminForm.actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <!-- 循环变量命名为 tool 而非 t：避免遮蔽 i18n 的 t() 函数 -->
                    <tr v-for="tool in tools" :key="tool.id">
                        <td class="app-table-cell-wrap">
                            <p class="text-strong font-medium">{{ tool.name }}</p>
                            <p class="text-faint text-xs">{{ tool.description }}</p>
                        </td>
                        <td>
                            <span :class="tool.type === 'http' ? 'app-badge-info' : 'app-badge-neutral'" class="app-badge">
                                {{ tool.type === 'http' ? 'HTTP' : t('adminForm.builtinTag') }}
                            </span>
                        </td>
                        <td>
                            <button :class="tool.enabled ? 'app-badge-success' : 'app-badge-neutral'" class="app-badge" @click="toggle(tool)">
                                {{ tool.enabled ? t('common.enabled') : t('common.disabled') }}
                            </button>
                        </td>
                        <td>
                            <div class="app-table-actions">
                                <button class="app-btn app-btn-soft app-btn-sm" @click="openEdit(tool)">{{ t('adminForm.edit') }}</button>
                                <button class="app-btn app-btn-danger app-btn-sm" @click="remove(tool.id)">{{ t('adminForm.delete') }}</button>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="!tools.length">
                        <td colspan="4" class="!whitespace-normal">
                            <div class="app-empty">
                                <span class="app-empty-icon">🛠️</span>
                                <p class="app-empty-title">{{ t('adminForm.toolEmpty') }}</p>
                                <p class="app-empty-desc">{{ t('adminForm.toolSubtitle') }}</p>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
