<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

interface McpItem {
    id: string;
    name: string;
    url: string;
    transport: string;
    headers: Record<string, string>;
    enabled: boolean;
}
interface McpTool {
    name: string;
    originalName: string;
    description: string;
}

const servers = ref<McpItem[]>([]);
const editing = ref<Partial<McpItem> | null>(null);
const formError = ref('');
/** 列表级错误（加载/切换/删除失败时提示） */
const listError = ref('');
const toolResult = ref<Record<string, { ok: boolean; message: string; tools: McpTool[] }>>({});
/** 保存中标记：防止重复提交并在请求期间禁用按钮 */
const saving = ref(false);

const form = reactive({
    name: '',
    url: '',
    transport: 'http',
    headersText: '{}',
    enabled: true,
});

async function load() {
    try {
        servers.value = await $fetch<McpItem[]>('/api/admin/mcp-servers');
        listError.value = '';
    } catch (e) {
        servers.value = [];
        listError.value = extractApiError(e, t('adminForm.loadFailed'));
    }
}

onMounted(load);

function openCreate() {
    editing.value = {};
    Object.assign(form, { name: '', url: '', transport: 'http', headersText: '{}', enabled: true });
    formError.value = '';
}

function openEdit(s: McpItem) {
    editing.value = s;
    Object.assign(form, {
        name: s.name,
        url: s.url,
        transport: s.transport,
        headersText: JSON.stringify(s.headers ?? {}, null, 2),
        enabled: s.enabled,
    });
    formError.value = '';
}

async function save() {
    if (saving.value) return;
    let headers: Record<string, string>;
    try {
        headers = JSON.parse(form.headersText || '{}');
    } catch {
        formError.value = t('adminForm.mcpInvalidHeaders');
        return;
    }
    if (!form.name.trim() || !form.url.trim()) {
        formError.value = t('adminForm.requiredName');
        return;
    }
    formError.value = '';
    saving.value = true;
    try {
        const body = { ...form, headers };
        if (editing.value?.id) {
            await $fetch(`/api/admin/mcp-servers/${editing.value.id}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/mcp-servers', { method: 'POST', body });
        }
        editing.value = null;
        await load();
    } catch (e) {
        formError.value = extractApiError(e, t('adminForm.saveFailed'));
    } finally {
        saving.value = false;
    }
}

async function listTools(s: McpItem) {
    toolResult.value[s.id] = { ok: true, message: t('adminForm.mcpConnecting'), tools: [] };
    try {
        const res = await $fetch<{ ok: boolean; message?: string; tools: McpTool[] }>(`/api/admin/mcp-servers/${s.id}/tools`);
        toolResult.value[s.id] = {
            ok: res.ok,
            message: res.ok ? t('adminForm.mcpToolsFound', { count: res.tools.length }) : (res.message ?? t('adminForm.mcpConnectFailed')),
            tools: res.tools ?? [],
        };
    } catch (e) {
        // 接口报错时也要落一个结果，否则文案会永久停在「连接中…」
        toolResult.value[s.id] = { ok: false, message: extractApiError(e, t('adminForm.mcpConnectFailed')), tools: [] };
    }
}

/**
 * 模板内安全读取探测结果（避免索引可能未定义）。
 */
function toolInfo(s: McpItem): { ok: boolean; message: string; tools: McpTool[] } {
    return toolResult.value[s.id] ?? { ok: true, message: '', tools: [] };
}

async function toggle(s: McpItem) {
    listError.value = '';
    try {
        await $fetch(`/api/admin/mcp-servers/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } });
        await load();
    } catch (e) {
        listError.value = extractApiError(e, t('adminForm.operationFailed'));
    }
}

async function remove(id: string) {
    if (!confirm(t('adminForm.mcpDeleteConfirm'))) return;
    listError.value = '';
    try {
        await $fetch(`/api/admin/mcp-servers/${id}`, { method: 'DELETE' });
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
                <h1 class="text-2xl font-bold text-gray-800">{{ t('adminForm.mcpTitle') }}</h1>
                <p class="mt-1 text-xs text-gray-400">{{ t('adminForm.mcpSubtitle') }}</p>
            </div>
            <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">{{ t('adminForm.mcpNew') }}</button>
        </div>

        <div v-if="editing !== null" class="mb-6 space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <div class="grid grid-cols-2 gap-3">
                <input v-model="form.name" :placeholder="t('adminForm.mcpNamePlaceholder')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <select v-model="form.transport" class="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option value="http">Streamable HTTP</option>
                    <option value="sse">SSE</option>
                </select>
            </div>
            <input
                v-model="form.url"
                :placeholder="t('adminForm.mcpUrlPlaceholder')"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
            />
            <textarea
                v-model="form.headersText"
                rows="2"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                :placeholder="t('adminForm.mcpHeadersPlaceholder')"
            />
            <label class="flex items-center gap-1 text-sm text-gray-600"><input v-model="form.enabled" type="checkbox" /> {{ t('adminForm.enable') }}</label>
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
                    <th class="p-4">MCP Server</th>
                    <th class="p-4">{{ t('adminForm.mcpTransport') }}</th>
                    <th class="p-4">{{ t('adminForm.status') }}</th>
                    <th class="p-4">{{ t('adminForm.actions') }}</th>
                </tr>
            </thead>
            <tbody>
                <template v-for="s in servers" :key="s.id">
                    <tr class="border-t border-gray-100">
                        <td class="p-4">
                            <p class="font-medium text-gray-800">{{ s.name }}</p>
                            <p class="font-mono text-xs text-gray-400">{{ s.url }}</p>
                            <p v-if="toolInfo(s).message" class="mt-1 text-xs" :class="toolInfo(s).ok ? 'text-green-600' : 'text-red-500'">
                                {{ toolInfo(s).message }}
                            </p>
                        </td>
                        <td class="p-4">
                            <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 uppercase">{{ s.transport }}</span>
                        </td>
                        <td class="p-4">
                            <button :class="s.enabled ? 'text-green-600' : 'text-gray-400'" @click="toggle(s)">
                                {{ s.enabled ? t('common.enabled') : t('common.disabled') }}
                            </button>
                        </td>
                        <td class="space-x-2 p-4">
                            <button class="text-blue-500 hover:underline" @click="listTools(s)">{{ t('adminForm.mcpListTools') }}</button>
                            <button class="text-green-600 hover:underline" @click="openEdit(s)">{{ t('adminForm.edit') }}</button>
                            <button class="text-red-500 hover:underline" @click="remove(s.id)">{{ t('adminForm.delete') }}</button>
                        </td>
                    </tr>
                    <tr v-if="toolInfo(s).tools?.length">
                        <td colspan="4" class="bg-gray-50 px-4 py-3">
                            <div class="flex flex-wrap gap-2">
                                <span
                                    v-for="tool in toolInfo(s).tools"
                                    :key="tool.name"
                                    :title="tool.description"
                                    class="rounded-full bg-white px-3 py-1 font-mono text-xs text-gray-600 shadow-sm"
                                >
                                    {{ tool.name }}
                                </span>
                            </div>
                        </td>
                    </tr>
                </template>
                <tr v-if="!servers.length">
                    <td colspan="4" class="p-8 text-center text-gray-400">{{ t('adminForm.mcpEmpty') }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
