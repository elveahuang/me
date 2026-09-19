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
        <div v-if="listError" class="app-alert app-alert-danger mb-4">
            {{ listError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('adminForm.mcpTitle') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.mcpSubtitle') }}</p>
            </div>
            <button class="app-btn app-btn-primary app-btn-sm" @click="openCreate">{{ t('adminForm.mcpNew') }}</button>
        </div>

        <AdminDrawer :open="editing !== null" :title="editing?.id ? t('common.edit') : t('adminForm.mcpNew')" @close="editing = null">
            <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <input v-model="form.name" :placeholder="t('adminForm.mcpNamePlaceholder')" class="app-input" />
                    <select v-model="form.transport" class="app-input">
                        <option value="http">Streamable HTTP</option>
                        <option value="sse">SSE</option>
                    </select>
                </div>
                <input v-model="form.url" :placeholder="t('adminForm.mcpUrlPlaceholder')" class="app-input !font-mono !text-xs" />
                <textarea v-model="form.headersText" rows="2" class="app-input !font-mono !text-xs" :placeholder="t('adminForm.mcpHeadersPlaceholder')" />
                <label class="text-soft flex items-center gap-1.5 text-sm"
                    ><input v-model="form.enabled" type="checkbox" class="app-checkbox" /> {{ t('adminForm.enable') }}</label
                >
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
                        <th>MCP Server</th>
                        <th>{{ t('adminForm.mcpTransport') }}</th>
                        <th>{{ t('adminForm.status') }}</th>
                        <th class="text-right">{{ t('adminForm.actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="s in servers" :key="s.id">
                        <tr>
                            <td class="app-table-cell-wrap">
                                <p class="text-strong font-medium">{{ s.name }}</p>
                                <p class="text-faint font-mono text-xs">{{ s.url }}</p>
                                <p v-if="toolInfo(s).message" class="mt-1 text-xs" :class="toolInfo(s).ok ? 'text-muted-2' : 'text-[color:var(--danger)]'">
                                    {{ toolInfo(s).message }}
                                </p>
                            </td>
                            <td>
                                <span class="app-chip uppercase">{{ s.transport }}</span>
                            </td>
                            <td>
                                <button :class="s.enabled ? 'app-badge-success' : 'app-badge-neutral'" class="app-badge" @click="toggle(s)">
                                    {{ s.enabled ? t('common.enabled') : t('common.disabled') }}
                                </button>
                            </td>
                            <td>
                                <div class="app-table-actions">
                                    <button class="app-btn app-btn-ghost app-btn-sm" @click="listTools(s)">
                                        {{ t('adminForm.mcpListTools') }}
                                    </button>
                                    <button class="app-btn app-btn-soft app-btn-sm" @click="openEdit(s)">{{ t('adminForm.edit') }}</button>
                                    <button class="app-btn app-btn-danger app-btn-sm" @click="remove(s.id)">{{ t('adminForm.delete') }}</button>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="toolInfo(s).tools?.length">
                            <td colspan="4" class="bg-surface-2 !whitespace-normal">
                                <div class="flex flex-wrap gap-2">
                                    <span v-for="tool in toolInfo(s).tools" :key="tool.name" :title="tool.description" class="app-chip font-mono">
                                        {{ tool.name }}
                                    </span>
                                </div>
                            </td>
                        </tr>
                    </template>
                    <tr v-if="!servers.length">
                        <td colspan="4" class="!whitespace-normal">
                            <div class="app-empty">
                                <span class="app-empty-icon">🔌</span>
                                <p class="app-empty-title">{{ t('adminForm.mcpEmpty') }}</p>
                                <p class="app-empty-desc">{{ t('adminForm.mcpSubtitle') }}</p>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
