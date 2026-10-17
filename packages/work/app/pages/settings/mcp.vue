<script setup lang="ts">

import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';
definePageMeta({ layout: 'settings' });

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
const loading = ref(true);
const editing = ref<Partial<McpItem> | null>(null);
const formError = ref('');
/** 列表级错误（加载/切换/删除失败时提示） */
const listError = ref('');
const toolResult = ref<Record<string, { ok: boolean; message: string; tools: McpTool[] }>>({});
/** 保存中标记：防止重复提交并在请求期间禁用按钮 */
const saving = ref(false);
/** 逐台服务器的工具探测在途标记 */
const probing = ref<Record<string, boolean>>({});
/** 启停在途标记：PATCH 发的是绝对值，列表刷新前的第二次点击会再发同一个值（与 tasks.vue 同口径） */
const toggling = ref<Set<string>>(new Set());

const form = reactive({
    name: '',
    url: '',
    transport: 'http',
    headersText: '{}',
    enabled: true,
});

/**
 * 表单归属令牌：保存是网络往返，而抽屉的 ✕/取消不随请求禁用。
 * 期间关掉 A 再打开 B，迟到的保存成功会把 B 的抽屉一起关掉、失败原因会写进 B 的表单。
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
        servers.value = await $fetch<McpItem[]>('/api/settings/mcp-servers');
        listError.value = '';
    } catch (e) {
        servers.value = [];
        listError.value = extractApiError(e, t('adminForm.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

function openCreate() {
    formToken += 1;
    // 上一张表单的在途保存已经不属于这里，不复位会让新表单的保存按钮一直停在「保存中」
    saving.value = false;
    editing.value = {};
    Object.assign(form, { name: '', url: '', transport: 'http', headersText: '{}', enabled: true });
    formError.value = '';
}

function openEdit(s: McpItem) {
    formToken += 1;
    saving.value = false;
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
    // 合法 JSON 但形状不对同样会毁掉配置：服务端 normalizeMcpHeaders 会 400，但那句是中文原文，
    // 英文界面读不到可本地化的信息；tools 表单早有同款本地预检，这里补齐（数组/非字符串值一并挡）
    if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.values(headers).some((v) => typeof v !== 'string')) {
        formError.value = t('adminForm.mcpInvalidHeaders');
        return;
    }
    if (!form.name.trim() || !form.url.trim()) {
        formError.value = t('adminForm.requiredName');
        return;
    }
    formError.value = '';
    saving.value = true;
    const token = formToken;
    try {
        // 显式列出字段：此前的 { ...form, headers } 会把编辑器原文 headersText 一起发上去
        const body = { name: form.name, url: form.url, transport: form.transport, enabled: form.enabled, headers };
        if (editing.value?.id) {
            await $fetch(`/api/settings/mcp-servers/${encodeURIComponent(editing.value.id)}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/settings/mcp-servers', { method: 'POST', body });
        }
        // 保存期间用户可能已关掉抽屉或改开另一台服务器：不能代他把当前这张表单关掉
        if (token === formToken) editing.value = null;
        await load();
    } catch (e) {
        const failure = extractApiError(e, t('adminForm.saveFailed'));
        // 抽屉已换成另一台服务器时，这条失败属于上一台：写进当前表单会被读成本次编辑的问题
        if (token === formToken) formError.value = failure;
        else listError.value = failure;
    } finally {
        if (token === formToken) saving.value = false;
    }
}

/**
 * 一次点击 = 建一条真实 MCP 连接（握手 + `tools/list`，预算十几秒起步），
 * 而按钮原本既不禁用也没有在途判定：连点 N 下就有 N 条并发连接打到同一台服务器上，
 * 对方不支持并发会话时后几条会以握手失败收场，界面显示的却是最后一次落进 `toolResult` 的那条——
 * 慢的那次往往更晚返回，于是「连接失败」会盖掉先前一次成功的结果。
 * 与 `providers.vue` 的 test()、本页 saving 同一口径：按行加在途标记，期间按钮禁用。
 */
async function listTools(s: McpItem) {
    if (probing.value[s.id]) return;
    probing.value[s.id] = true;
    toolResult.value[s.id] = { ok: true, message: t('adminForm.mcpConnecting'), tools: [] };
    try {
        const res = await $fetch<{ ok: boolean; message?: string; tools: McpTool[] }>(`/api/settings/mcp-servers/${encodeURIComponent(s.id)}/tools`);
        toolResult.value[s.id] = {
            ok: res.ok,
            message: res.ok ? t('adminForm.mcpToolsFound', { count: res.tools.length }) : (res.message ?? t('adminForm.mcpConnectFailed')),
            tools: res.tools ?? [],
        };
    } catch (e) {
        // 接口报错时也要落一个结果，否则文案会永久停在「连接中…」
        toolResult.value[s.id] = { ok: false, message: extractApiError(e, t('adminForm.mcpConnectFailed')), tools: [] };
    } finally {
        probing.value[s.id] = false;
    }
}

/**
 * 模板内安全读取探测结果（避免索引可能未定义）。
 */
function toolInfo(s: McpItem): { ok: boolean; message: string; tools: McpTool[] } {
    return toolResult.value[s.id] ?? { ok: true, message: '', tools: [] };
}

async function toggle(s: McpItem) {
    if (toggling.value.has(s.id)) return;
    toggling.value = new Set(toggling.value).add(s.id);
    listError.value = '';
    try {
        await $fetch(`/api/settings/mcp-servers/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: { enabled: !s.enabled } });
        await load();
    } catch (e) {
        listError.value = extractApiError(e, t('adminForm.operationFailed'));
    } finally {
        const next = new Set(toggling.value);
        next.delete(s.id);
        toggling.value = next;
    }
}

async function remove(id: string) {
    if (!confirm(t('adminForm.mcpDeleteConfirm'))) return;
    listError.value = '';
    try {
        await $fetch(`/api/settings/mcp-servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
                <h1 class="app-page-title text-strong">{{ t('settings.navMcp') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.mcpSubtitle') }}</p>
            </div>
            <button class="app-btn app-btn-primary app-btn-sm" @click="openCreate">{{ t('adminForm.mcpNew') }}</button>
        </div>

        <AdminDrawer :open="editing !== null" :title="editing?.id ? t('common.edit') : t('adminForm.mcpNew')" @close="closeDrawer">
            <div class="space-y-3">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                        :aria-label="t('adminForm.mcpNamePlaceholder')"
                        v-model="form.name"
                        :placeholder="t('adminForm.mcpNamePlaceholder')"
                        class="app-input"
                    />
                    <select v-model="form.transport" :aria-label="t('adminForm.mcpTransport')" class="app-input">
                        <option value="http">Streamable HTTP</option>
                        <option value="sse">SSE</option>
                    </select>
                </div>
                <input
                    :aria-label="t('adminForm.mcpUrlPlaceholder')"
                    v-model="form.url"
                    :placeholder="t('adminForm.mcpUrlPlaceholder')"
                    class="app-input !font-mono !text-xs"
                />
                <textarea
                    :aria-label="t('adminForm.mcpHeadersLabel')"
                    v-model="form.headersText"
                    rows="2"
                    class="app-input !font-mono !text-xs"
                    :placeholder="t('adminForm.mcpHeadersPlaceholder')"
                />
                <label class="text-soft flex items-center gap-1.5 text-sm"
                    ><input v-model="form.enabled" type="checkbox" class="app-checkbox" /> {{ t('adminForm.enable') }}</label
                >
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
                                <button
                                    type="button"
                                    role="switch"
                                    class="app-switch"
                                    :aria-checked="s.enabled"
                                    :aria-label="t('adminForm.enable')"
                                    :title="s.enabled ? t('common.enabled') : t('common.disabled')"
                                    :disabled="toggling.has(s.id)"
                                    @click="toggle(s)"
                                />
                            </td>
                            <td>
                                <div class="app-table-actions">
                                    <button class="app-btn app-btn-ghost app-btn-sm" :disabled="probing[s.id]" @click="listTools(s)">
                                        {{ probing[s.id] ? t('adminForm.mcpConnecting') : t('adminForm.mcpListTools') }}
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
                    <!-- 加载失败时不渲染空态：接口故障不能被读成「没有数据」 -->
                    <tr v-if="!listError && !servers.length">
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
