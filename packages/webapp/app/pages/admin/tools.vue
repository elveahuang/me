<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' });

interface ToolItem {
    id: string;
    name: string;
    description: string;
    type: string;
    config: Record<string, unknown>;
    enabled: boolean;
}

const tools = ref<ToolItem[]>([]);
const editing = ref<Partial<ToolItem> | null>(null);
const formError = ref('');

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
    tools.value = await $fetch('/api/admin/tools');
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
        formError.value = 'Headers / 参数定义不是合法的 JSON';
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
    formError.value = '';
    const config = buildConfig();
    if (config === null) return;
    if (!form.name.trim()) {
        formError.value = '名称必填';
        return;
    }
    const body = {
        name: form.name,
        description: form.description,
        type: form.type,
        enabled: form.enabled,
        config,
    };
    try {
        if (editing.value?.id) {
            await $fetch(`/api/admin/tools/${editing.value.id}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/tools', { method: 'POST', body });
        }
    } catch (e: any) {
        formError.value = e?.data?.statusMessage || e?.message || '保存失败';
        return;
    }
    editing.value = null;
    await load();
}

async function toggle(tool: ToolItem) {
    await $fetch(`/api/admin/tools/${tool.id}`, { method: 'PATCH', body: { enabled: !tool.enabled } });
    await load();
}

async function remove(id: string) {
    if (!confirm('确认删除该 Tool？')) return;
    await $fetch(`/api/admin/tools/${id}`, { method: 'DELETE' });
    await load();
}
</script>

<template>
    <div>
        <div class="mb-6 flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">Tool 管理</h1>
                <p class="mt-1 text-xs text-gray-400">
                    Tool 是可执行的 AI SDK 工具，挂载到智能体后进入 ReAct 循环。内置工具开箱即用，HTTP 工具的 URL / 方法 / 参数全部后台可配。
                </p>
            </div>
            <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">新建 Tool</button>
        </div>

        <div v-if="editing !== null" class="mb-6 space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <div class="grid grid-cols-2 gap-3">
                <input v-model="form.name" placeholder="名称，如：当前时间" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <select v-model="form.type" class="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option value="builtin_time">内置：查询当前时间</option>
                    <option value="http">HTTP 工具（自定义接口）</option>
                </select>
            </div>
            <input v-model="form.description" placeholder="描述（会作为工具说明传给模型）" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />

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
                        placeholder="接口 URL，如 https://api.example.com/weather"
                        class="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    />
                </div>
                <textarea
                    v-model="form.parametersText"
                    rows="4"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    placeholder='参数定义（数组）：[{"name":"city","type":"string","description":"城市名","required":true}]'
                />
                <textarea
                    v-model="form.headersText"
                    rows="2"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    placeholder='固定请求头：{"Authorization": "Bearer xxx"}'
                />
                <textarea
                    v-if="form.method !== 'GET'"
                    v-model="form.bodyTemplate"
                    rows="2"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    placeholder="POST/PUT 请求体模板，可用 {{参数名}} 占位；留空则整体作为 JSON 发送"
                />
            </template>

            <label class="flex items-center gap-1 text-sm text-gray-600"> <input v-model="form.enabled" type="checkbox" /> 启用 </label>
            <p v-if="formError" class="text-sm text-red-500">{{ formError }}</p>
            <div class="flex gap-2">
                <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="save">保存</button>
                <button class="rounded-lg bg-gray-100 px-4 py-1.5 text-sm" @click="editing = null">取消</button>
            </div>
        </div>

        <table class="w-full rounded-2xl bg-white text-sm shadow-sm">
            <thead class="text-left text-gray-400">
                <tr>
                    <th class="p-4">Tool</th>
                    <th class="p-4">类型</th>
                    <th class="p-4">状态</th>
                    <th class="p-4">操作</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="t in tools" :key="t.id" class="border-t border-gray-100">
                    <td class="p-4">
                        <p class="font-medium text-gray-800">{{ t.name }}</p>
                        <p class="text-xs text-gray-400">{{ t.description }}</p>
                    </td>
                    <td class="p-4">
                        <span :class="t.type === 'http' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'" class="rounded-full px-2 py-0.5 text-xs">
                            {{ t.type === 'http' ? 'HTTP' : '内置' }}
                        </span>
                    </td>
                    <td class="p-4">
                        <button :class="t.enabled ? 'text-green-600' : 'text-gray-400'" @click="toggle(t)">
                            {{ t.enabled ? '启用' : '停用' }}
                        </button>
                    </td>
                    <td class="space-x-2 p-4">
                        <button class="text-green-600 hover:underline" @click="openEdit(t)">编辑</button>
                        <button class="text-red-500 hover:underline" @click="remove(t.id)">删除</button>
                    </td>
                </tr>
                <tr v-if="!tools.length">
                    <td colspan="4" class="p-8 text-center text-gray-400">暂无 Tool</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
