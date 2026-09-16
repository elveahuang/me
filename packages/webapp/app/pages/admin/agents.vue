<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' });

interface SkillItem {
    id: string;
    name: string;
}
interface KbItem {
    id: string;
    name: string;
}
interface ProviderItem {
    id: string;
    name: string;
    models: string[];
    enabled: boolean;
}
interface AgentItem {
    id: string;
    name: string;
    emoji: string | null;
    avatar: string | null;
    description: string;
    systemPrompt: string;
    model: string;
    providerId: string | null;
    selfConfig: boolean;
    enabled: boolean;
    temperature?: number | null;
    maxTokens?: number | null;
    maxSteps?: number | null;
    skillIds: string[];
    skills: SkillItem[];
    toolIds: string[];
    tools: { id: string; name: string; type: string }[];
    kbIds: string[];
    mcpIds: string[];
    provider?: { id: string; name: string; models: string[] } | null;
    knowledgeBases?: KbItem[];
    mcpServers?: { id: string; name: string }[];
}

const agents = ref<AgentItem[]>([]);
const skillList = ref<SkillItem[]>([]);
const toolList = ref<{ id: string; name: string; type: string }[]>([]);
const kbList = ref<KbItem[]>([]);
const mcpList = ref<{ id: string; name: string }[]>([]);
const providerList = ref<ProviderItem[]>([]);
const editing = ref<Partial<AgentItem> | null>(null);

const autoConfigModalOpen = ref(false);
const autoConfigPrompt = ref('');
const autoConfigLoading = ref(false);
const autoConfigError = ref('');

const form = reactive({
    name: '',
    emoji: '',
    description: '',
    systemPrompt: '',
    providerId: '',
    model: 'deepseek-chat',
    selfConfig: false,
    enabled: true,
    temperature: 0.7,
    maxTokens: null as number | null,
    maxSteps: 6,
    skillIds: [] as string[],
    toolIds: [] as string[],
    kbIds: [] as string[],
    mcpIds: [] as string[],
});

const selectedProviderModels = computed(() => {
    const p = providerList.value.find((x) => x.id === form.providerId);
    return p?.models?.length ? p.models : ['deepseek-chat', 'deepseek-reasoner'];
});

async function load() {
    agents.value = await $fetch('/api/admin/agents');
    skillList.value = await $fetch('/api/admin/skills');
    toolList.value = await $fetch<{ id: string; name: string; type: string; enabled: boolean }[]>('/api/admin/tools').then((list) =>
        list.filter((t) => t.enabled),
    );
    kbList.value = await $fetch('/api/admin/knowledge-bases');
    mcpList.value = (await $fetch<{ id: string; name: string; enabled: boolean }[]>('/api/admin/mcp-servers'))
        .filter((s) => s.enabled)
        .map((s) => ({ id: s.id, name: s.name }));
    providerList.value = (await $fetch<ProviderItem[]>('/api/admin/providers')).filter((p) => p.enabled);
}

onMounted(load);

function openCreate() {
    editing.value = {};
    Object.assign(form, {
        name: '',
        emoji: '',
        description: '',
        systemPrompt: '',
        providerId: '',
        model: 'deepseek-chat',
        selfConfig: false,
        enabled: true,
        temperature: 0.7,
        maxTokens: null,
        maxSteps: 6,
        skillIds: [],
        toolIds: [],
        kbIds: [],
        mcpIds: [],
    });
}

function openEdit(agent: AgentItem) {
    editing.value = agent;
    Object.assign(form, {
        name: agent.name,
        emoji: agent.emoji ?? agent.avatar ?? '',
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        providerId: agent.providerId ?? '',
        model: agent.model,
        selfConfig: agent.selfConfig,
        enabled: agent.enabled,
        temperature: agent.temperature ?? 0.7,
        maxTokens: agent.maxTokens ?? null,
        maxSteps: agent.maxSteps ?? 6,
        skillIds: [...agent.skillIds],
        toolIds: [...(agent.toolIds ?? [])],
        kbIds: [...agent.kbIds],
        mcpIds: [...(agent.mcpIds ?? [])],
    });
}

async function handleAutoConfig() {
    if (!autoConfigPrompt.value.trim() || autoConfigPrompt.value.trim().length < 5) {
        autoConfigError.value = '请至少输入 5 个字的用途描述';
        return;
    }
    autoConfigLoading.value = true;
    autoConfigError.value = '';
    try {
        const res = await $fetch<{
            name: string;
            avatar: string;
            description: string;
            systemPrompt: string;
            providerId: string | null;
            model: string;
            skillIds: string[];
            toolIds: string[];
            mcpIds: string[];
            kbIds: string[];
            temperature: number;
            maxTokens: number | null;
            maxSteps: number;
        }>('/api/admin/agents/auto-config', {
            method: 'POST',
            body: { description: autoConfigPrompt.value },
        });

        editing.value = {};
        Object.assign(form, {
            name: res.name || '',
            emoji: res.avatar || '🤖',
            description: res.description || '',
            systemPrompt: res.systemPrompt || '',
            providerId: res.providerId || '',
            model: res.model || 'deepseek-chat',
            selfConfig: false,
            enabled: true,
            skillIds: res.skillIds || [],
            toolIds: res.toolIds || [],
            kbIds: res.kbIds || [],
            mcpIds: res.mcpIds || [],
            temperature: res.temperature ?? 0.7,
            maxTokens: res.maxTokens ?? null,
            maxSteps: res.maxSteps ?? 6,
        });
        autoConfigModalOpen.value = false;
        autoConfigPrompt.value = '';
    } catch (e: any) {
        autoConfigError.value = e?.data?.statusMessage || e?.message || '自动生成失败，请重试';
    } finally {
        autoConfigLoading.value = false;
    }
}

async function save() {
    const body = { ...form, providerId: form.providerId || null };
    if (editing.value?.id) {
        await $fetch(`/api/admin/agents/${editing.value.id}`, { method: 'PATCH', body });
    } else {
        await $fetch('/api/admin/agents', { method: 'POST', body });
    }
    editing.value = null;
    await load();
}

async function remove(id: string) {
    if (!confirm('确认删除该智能体？')) return;
    await $fetch(`/api/admin/agents/${id}`, { method: 'DELETE' });
    await load();
}
</script>

<template>
    <div>
        <div class="mb-6 flex items-center justify-between">
            <h1 class="text-2xl font-bold text-gray-800">智能体管理</h1>
            <div class="flex items-center gap-2">
                <button
                    class="flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-100"
                    @click="autoConfigModalOpen = true"
                >
                    <span>✨</span> AI 智能配置
                </button>
                <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">新建智能体</button>
            </div>
        </div>

        <div v-if="editing !== null" class="mb-6 space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <div class="grid grid-cols-2 gap-3">
                <input v-model="form.name" placeholder="名称" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input v-model="form.emoji" placeholder="头像 emoji，如 🤖" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <input v-model="form.description" placeholder="描述" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <textarea v-model="form.systemPrompt" placeholder="系统提示词" rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="mb-1 block text-xs text-gray-400">供应商</label>
                    <select v-model="form.providerId" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option value="">默认供应商</option>
                        <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.name }}</option>
                    </select>
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-400">模型</label>
                    <input
                        v-model="form.model"
                        list="provider-models"
                        placeholder="模型 id"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                    />
                    <datalist id="provider-models">
                        <option v-for="m in selectedProviderModels" :key="m" :value="m" />
                    </datalist>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-3">
                <div>
                    <label class="mb-1 block text-xs text-gray-400">Temperature (0.0 ~ 2.0)</label>
                    <input
                        v-model.number="form.temperature"
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        placeholder="0.7"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
                    />
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-400">Max Tokens (可选)</label>
                    <input
                        v-model.number="form.maxTokens"
                        type="number"
                        min="1"
                        placeholder="不限"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
                    />
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-400">Max Steps (工具调用轮数)</label>
                    <input
                        v-model.number="form.maxSteps"
                        type="number"
                        min="1"
                        max="30"
                        placeholder="6"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
                    />
                </div>
            </div>
            <div class="flex items-center gap-4 text-sm text-gray-600">
                <label class="flex items-center gap-1"><input v-model="form.enabled" type="checkbox" /> 启用</label>
                <label class="flex items-center gap-1">
                    <input v-model="form.selfConfig" type="checkbox" />
                    允许智能体自主调整模型 / Skill / Tool / MCP
                </label>
            </div>
            <div>
                <p class="mb-1 text-sm text-gray-600">绑定 Skill（指令块，注入系统提示词）</p>
                <div class="flex flex-wrap gap-2">
                    <label v-for="s in skillList" :key="s.id" class="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                        <input v-model="form.skillIds" type="checkbox" :value="s.id" />
                        {{ s.name }}
                    </label>
                </div>
            </div>
            <div>
                <p class="mb-1 text-sm text-gray-600">绑定 Tool（可执行工具，进入 ReAct 循环）</p>
                <div class="flex flex-wrap gap-2">
                    <label v-for="t in toolList" :key="t.id" class="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                        <input v-model="form.toolIds" type="checkbox" :value="t.id" />
                        {{ t.name }}
                        <span class="text-[10px] text-gray-400">{{ t.type === 'http' ? 'HTTP' : '内置' }}</span>
                    </label>
                    <span v-if="!toolList.length" class="text-xs text-gray-400">暂无 Tool，请先在「Tool 管理」页创建</span>
                </div>
            </div>
            <div>
                <p class="mb-1 text-sm text-gray-600">绑定知识库</p>
                <div class="flex flex-wrap gap-2">
                    <label v-for="kb in kbList" :key="kb.id" class="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                        <input v-model="form.kbIds" type="checkbox" :value="kb.id" />
                        {{ kb.name }}
                    </label>
                    <span v-if="!kbList.length" class="text-xs text-gray-400">暂无知识库，请先在「知识库」页创建</span>
                </div>
            </div>
            <div>
                <p class="mb-1 text-sm text-gray-600">绑定 MCP 服务器</p>
                <div class="flex flex-wrap gap-2">
                    <label v-for="m in mcpList" :key="m.id" class="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                        <input v-model="form.mcpIds" type="checkbox" :value="m.id" />
                        {{ m.name }}
                    </label>
                    <span v-if="!mcpList.length" class="text-xs text-gray-400">暂无 MCP 服务器，请先在「MCP 服务器」页创建</span>
                </div>
            </div>
            <div class="flex gap-2">
                <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="save">保存</button>
                <button class="rounded-lg bg-gray-100 px-4 py-1.5 text-sm" @click="editing = null">取消</button>
            </div>
        </div>

        <table class="w-full rounded-2xl bg-white text-sm shadow-sm">
            <thead class="text-left text-gray-400">
                <tr>
                    <th class="p-4">智能体</th>
                    <th class="p-4">模型</th>
                    <th class="p-4">Skills</th>
                    <th class="p-4">Tools</th>
                    <th class="p-4">知识库</th>
                    <th class="p-4">状态</th>
                    <th class="p-4">操作</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="a in agents" :key="a.id" class="border-t border-gray-100">
                    <td class="p-4">
                        <p class="font-medium text-gray-800">
                            {{ a.emoji || a.avatar || '🤖' }} {{ a.name }}
                            <span v-if="a.selfConfig" class="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-600" title="允许自主配置">自配置</span>
                        </p>
                        <p class="text-xs text-gray-400">{{ a.description }}</p>
                    </td>
                    <td class="p-4 font-mono text-xs text-gray-500">{{ a.provider?.name ?? '默认' }} / {{ a.model }}</td>
                    <td class="p-4">
                        <span v-for="s in a.skills" :key="s.id" class="mr-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                            {{ s.name }}
                        </span>
                        <span v-if="!a.skills?.length" class="text-xs text-gray-300">-</span>
                    </td>
                    <td class="p-4">
                        <span v-for="t in a.tools" :key="t.id" class="mr-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">
                            {{ t.name }}
                        </span>
                        <span v-if="!a.tools?.length" class="text-xs text-gray-300">-</span>
                    </td>
                    <td class="p-4">
                        <span v-for="kb in a.knowledgeBases" :key="kb.id" class="mr-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
                            {{ kb.name }}
                        </span>
                        <span v-if="!a.knowledgeBases?.length" class="text-xs text-gray-300">-</span>
                    </td>
                    <td class="p-4">
                        <span :class="a.enabled ? 'text-green-600' : 'text-gray-400'">{{ a.enabled ? '启用' : '停用' }}</span>
                    </td>
                    <td class="space-x-2 p-4">
                        <button class="text-green-600 hover:underline" @click="openEdit(a)">编辑</button>
                        <button class="text-red-500 hover:underline" @click="remove(a.id)">删除</button>
                    </td>
                </tr>
                <tr v-if="!agents.length">
                    <td colspan="7" class="p-8 text-center text-gray-400">暂无智能体</td>
                </tr>
            </tbody>
        </table>

        <!-- AI Auto-Config Modal -->
        <div v-if="autoConfigModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
            <div class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
                <div class="mb-4 flex items-center justify-between">
                    <h3 class="flex items-center gap-2 text-lg font-bold text-gray-800"><span>✨</span> AI 自动生成智能体配置</h3>
                    <button class="text-gray-400 hover:text-gray-600" @click="autoConfigModalOpen = false">✕</button>
                </div>
                <p class="mb-3 text-xs text-gray-500">
                    描述你想要的智能体角色与职能，AI 将自动分析系统内可用的模型、Skills、知识库与 MCP，并生成最佳配置方案。
                </p>
                <textarea
                    v-model="autoConfigPrompt"
                    rows="4"
                    placeholder="例如：需要一个资深的 Python 数据分析专家，精通 Pandas 与绘图，能通过代码解决业务统计需求..."
                    class="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-purple-500 focus:outline-none"
                />
                <p v-if="autoConfigError" class="mt-2 text-xs text-red-500">{{ autoConfigError }}</p>
                <div class="mt-4 flex justify-end gap-2">
                    <button
                        class="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-600 hover:bg-gray-200"
                        :disabled="autoConfigLoading"
                        @click="autoConfigModalOpen = false"
                    >
                        取消
                    </button>
                    <button
                        class="flex items-center gap-1.5 rounded-lg bg-purple-600 px-5 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                        :disabled="autoConfigLoading || !autoConfigPrompt.trim()"
                        @click="handleAutoConfig"
                    >
                        <span v-if="autoConfigLoading" class="animate-spin">🔄</span>
                        <span>{{ autoConfigLoading ? '生成中...' : '生成配置' }}</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
