<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' });

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

const form = reactive({
    name: '',
    baseUrl: '',
    apiKey: '',
    enabled: true,
    isDefault: false,
});

async function load() {
    providers.value = await $fetch('/api/admin/providers');
}

onMounted(load);

function openCreate() {
    editing.value = {};
    Object.assign(form, { name: '', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', enabled: true, isDefault: false });
    modelsText.value = '';
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
}

async function save() {
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
    await load();
}

async function test(p: ProviderItem) {
    testResult.value[p.id] = '测试中…';
    const res = await $fetch<{ ok: boolean; message: string }>(`/api/admin/providers/${p.id}/test`, {
        method: 'POST',
    });
    testResult.value[p.id] = res.message;
    await load();
}

async function toggle(p: ProviderItem) {
    await $fetch(`/api/admin/providers/${p.id}`, { method: 'PATCH', body: { enabled: !p.enabled } });
    await load();
}

async function remove(id: string) {
    if (!confirm('确认删除该供应商？')) return;
    await $fetch(`/api/admin/providers/${id}`, { method: 'DELETE' });
    await load();
}
</script>

<template>
    <div>
        <div class="mb-6 flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">模型供应商</h1>
                <p class="mt-1 text-xs text-gray-400">所有供应商按 OpenAI 兼容协议接入（DeepSeek / 通义 / OpenAI / 自建网关，改 Base URL 即可）。</p>
            </div>
            <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">新建供应商</button>
        </div>

        <div v-if="editing !== null" class="mb-6 space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <div class="grid grid-cols-2 gap-3">
                <input v-model="form.name" placeholder="名称，如 DeepSeek" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input v-model="form.baseUrl" placeholder="Base URL（OpenAI 兼容）" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <input
                v-model="form.apiKey"
                :placeholder="editing.id ? `API Key（当前 ${form.apiKey || '未设置'}，留空保持不变）` : 'API Key'"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
                v-model="modelsText"
                rows="3"
                placeholder="模型列表（每行一个，也可用「测试连接」自动拉取）"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
            />
            <div class="flex items-center gap-4 text-sm text-gray-600">
                <label class="flex items-center gap-1"><input v-model="form.enabled" type="checkbox" /> 启用</label>
                <label class="flex items-center gap-1"><input v-model="form.isDefault" type="checkbox" /> 默认供应商</label>
            </div>
            <div class="flex gap-2">
                <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="save">保存</button>
                <button class="rounded-lg bg-gray-100 px-4 py-1.5 text-sm" @click="editing = null">取消</button>
            </div>
        </div>

        <table class="w-full rounded-2xl bg-white text-sm shadow-sm">
            <thead class="text-left text-gray-400">
                <tr>
                    <th class="p-4">供应商</th>
                    <th class="p-4">Base URL</th>
                    <th class="p-4">API Key</th>
                    <th class="p-4">模型数</th>
                    <th class="p-4">状态</th>
                    <th class="p-4">操作</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="p in providers" :key="p.id" class="border-t border-gray-100">
                    <td class="p-4">
                        <p class="font-medium text-gray-800">
                            {{ p.name }}
                            <span v-if="p.isDefault" class="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-600">默认</span>
                        </p>
                        <p class="mt-1 text-xs text-gray-400">{{ testResult[p.id] }}</p>
                    </td>
                    <td class="p-4 font-mono text-xs text-gray-500">{{ p.baseUrl }}</td>
                    <td class="p-4 font-mono text-xs text-gray-500">{{ p.apiKey || '未设置' }}</td>
                    <td class="p-4 text-gray-500">{{ p.models?.length ?? 0 }}</td>
                    <td class="p-4">
                        <button :class="p.enabled ? 'text-green-600' : 'text-gray-400'" @click="toggle(p)">
                            {{ p.enabled ? '启用' : '停用' }}
                        </button>
                    </td>
                    <td class="space-x-2 p-4">
                        <button class="text-blue-500 hover:underline" @click="test(p)">测试连接</button>
                        <button class="text-green-600 hover:underline" @click="openEdit(p)">编辑</button>
                        <button class="text-red-500 hover:underline" @click="remove(p.id)">删除</button>
                    </td>
                </tr>
                <tr v-if="!providers.length">
                    <td colspan="6" class="p-8 text-center text-gray-400">暂无供应商</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
