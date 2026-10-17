<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

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
const loading = ref(true);
const editing = ref<Partial<ToolItem> | null>(null);
const formError = ref('');
/** 列表级错误（切换/删除失败时提示，避免静默） */
const listError = ref('');
/** 保存中标记：防止重复提交并在请求期间禁用按钮 */
const saving = ref(false);
/** 启停在途标记：PATCH 发的是绝对值，列表刷新前的第二次点击会再发同一个值（与 tasks.vue 同口径） */
const toggling = ref<Set<string>>(new Set());

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

/**
 * 表单归属令牌：保存是网络往返，而抽屉的 ✕/取消不随请求禁用。
 * 期间关掉 A 再打开 B，迟到的成功会把 B 的表单一起关掉、失败原因会写进 B 的表单。
 */
let formToken = 0;

/** 关闭抽屉：令牌一并作废，在途保存的失败提示不能写进一个已经关掉的抽屉 */
function closeDrawer() {
    formToken += 1;
    saving.value = false;
    editing.value = null;
}

async function load() {
    loading.value = true;
    try {
        tools.value = await $fetch<ToolItem[]>('/api/settings/tools');
        listError.value = '';
    } catch (e) {
        tools.value = [];
        listError.value = extractApiError(e, t('adminForm.loadFailed'));
    } finally {
        loading.value = false;
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
    // 合法 JSON 但类型不对同样会毁掉工具：服务端对 parameters 做 for...of、对 headers 做展开，
    // 非数组/非对象会让该工具在每次对话执行时抛错
    if (!Array.isArray(parameters) || !headers || typeof headers !== 'object' || Array.isArray(headers)) {
        formError.value = t('adminForm.toolInvalidJson');
        return null;
    }
    // 元素级形状同样会毁掉工具：null 元素在 buildInputSchema 里当场抛错，重名参数只留下其中一个
    const paramNames = new Set<string>();
    for (const item of parameters) {
        const param = item as { name?: unknown } | null;
        const name = param && typeof param === 'object' && !Array.isArray(param) && typeof param.name === 'string' ? param.name.trim() : '';
        if (!name || paramNames.has(name)) {
            formError.value = t('adminForm.toolInvalidJson');
            return null;
        }
        paramNames.add(name);
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
    formToken += 1;
    // 上一张表单的在途保存已经不属于这里，不复位会让新表单的保存按钮一直停在「保存中」
    saving.value = false;
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
    formToken += 1;
    saving.value = false;
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
    const token = formToken;
    try {
        if (editing.value?.id) {
            await $fetch(`/api/settings/tools/${encodeURIComponent(editing.value.id)}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/settings/tools', { method: 'POST', body });
        }
        // 保存期间用户可能已关掉抽屉或改开另一条工具：不能代他把当前这张表单关掉
        if (token === formToken) editing.value = null;
        await load();
    } catch (e) {
        const failure = extractApiError(e, t('adminForm.saveFailed'));
        // 抽屉已换成另一条工具时，这条失败属于上一条：写进当前表单会被读成本次编辑的问题
        if (token === formToken) formError.value = failure;
        else listError.value = failure;
    } finally {
        if (token === formToken) saving.value = false;
    }
}

async function toggle(tool: ToolItem) {
    if (toggling.value.has(tool.id)) return;
    toggling.value = new Set(toggling.value).add(tool.id);
    listError.value = '';
    try {
        await $fetch(`/api/settings/tools/${encodeURIComponent(tool.id)}`, { method: 'PATCH', body: { enabled: !tool.enabled } });
        await load();
    } catch (e) {
        listError.value = extractApiError(e, t('adminForm.operationFailed'));
    } finally {
        const next = new Set(toggling.value);
        next.delete(tool.id);
        toggling.value = next;
    }
}

async function remove(id: string) {
    if (!confirm(t('adminForm.toolDeleteConfirm'))) return;
    listError.value = '';
    try {
        await $fetch(`/api/settings/tools/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await load();
    } catch (e) {
        listError.value = extractApiError(e, t('adminForm.deleteFailed'));
    }
}
</script>

<template>
    <div>
        <WorkSettingsNav class="mb-5" />
        <div v-if="listError" class="app-alert app-alert-danger mb-4">
            {{ listError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('settings.navTools') }}</h1>
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
            @close="closeDrawer"
        >
            <div class="space-y-3">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                        :aria-label="t('adminForm.toolNamePlaceholder')"
                        v-model="form.name"
                        :placeholder="t('adminForm.toolNamePlaceholder')"
                        class="app-input"
                    />
                    <select v-model="form.type" :aria-label="t('adminForm.colType')" class="app-input">
                        <option value="builtin_time">{{ t('adminForm.toolTypeBuiltin') }}</option>
                        <option value="http">{{ t('adminForm.toolTypeHttp') }}</option>
                    </select>
                </div>
                <input
                    :aria-label="t('adminForm.toolDescPlaceholder')"
                    v-model="form.description"
                    :placeholder="t('adminForm.toolDescPlaceholder')"
                    class="app-input"
                />

                <template v-if="form.type === 'http'">
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_1fr]">
                        <select v-model="form.method" :aria-label="t('adminForm.selectMethod')" class="app-input">
                            <option>GET</option>
                            <option>POST</option>
                            <option>PUT</option>
                            <option>DELETE</option>
                        </select>
                        <input
                            :aria-label="t('adminForm.toolUrlPlaceholder')"
                            v-model="form.url"
                            :placeholder="t('adminForm.toolUrlPlaceholder')"
                            class="app-input !font-mono !text-xs"
                        />
                    </div>
                    <textarea
                        :aria-label="t('adminForm.toolParamsLabel')"
                        v-model="form.parametersText"
                        rows="4"
                        class="app-input !font-mono !text-xs"
                        :placeholder="`${t('adminForm.toolParamsLabel')}${PARAMS_SAMPLE}`"
                    />
                    <textarea
                        :aria-label="t('adminForm.toolHeadersLabel')"
                        v-model="form.headersText"
                        rows="2"
                        class="app-input !font-mono !text-xs"
                        :placeholder="`${t('adminForm.toolHeadersLabel')}${HEADERS_SAMPLE}`"
                    />
                    <textarea
                        :aria-label="t('adminForm.toolBodyPlaceholder')"
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
                <button class="app-btn app-btn-ghost" :disabled="saving" @click="closeDrawer">{{ t('adminForm.cancel') }}</button>
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
                            <button
                                type="button"
                                role="switch"
                                class="app-switch"
                                :aria-checked="tool.enabled"
                                :aria-label="t('adminForm.enable')"
                                :title="tool.enabled ? t('common.enabled') : t('common.disabled')"
                                :disabled="toggling.has(tool.id)"
                                @click="toggle(tool)"
                            />
                        </td>
                        <td>
                            <div class="app-table-actions">
                                <button class="app-btn app-btn-soft app-btn-sm" @click="openEdit(tool)">{{ t('adminForm.edit') }}</button>
                                <button class="app-btn app-btn-danger app-btn-sm" @click="remove(tool.id)">{{ t('adminForm.delete') }}</button>
                            </div>
                        </td>
                    </tr>
                    <!-- 加载失败时不渲染空态：接口故障不能被读成「没有数据」 -->
                    <tr v-if="!listError && !tools.length">
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
