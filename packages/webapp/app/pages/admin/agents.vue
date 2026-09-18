<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

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
const formError = ref('');
const listError = ref('');
const saving = ref(false);

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
    listError.value = '';
    try {
        const [agentRows, skills, tools, kbs, mcps, providers] = await Promise.all([
            $fetch('/api/admin/agents'),
            $fetch('/api/admin/skills'),
            $fetch<{ id: string; name: string; type: string; enabled: boolean }[]>('/api/admin/tools'),
            $fetch('/api/admin/knowledge-bases'),
            $fetch<{ id: string; name: string; enabled: boolean }[]>('/api/admin/mcp-servers'),
            $fetch<ProviderItem[]>('/api/admin/providers'),
        ]);
        agents.value = agentRows;
        skillList.value = skills;
        toolList.value = tools.filter((t) => t.enabled);
        kbList.value = kbs;
        mcpList.value = mcps.filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name }));
        providerList.value = providers.filter((p) => p.enabled);
    } catch (e) {
        // 加载失败必须显式报错并清空列表，否则空数组会渲染成「暂无智能体」，把接口故障读成没有数据
        agents.value = [];
        listError.value = extractApiError(e, t('common.loadFailed'));
    }
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
        autoConfigError.value = t('adminForm.agentAutoTooShort');
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
    } catch (e) {
        autoConfigError.value = extractApiError(e, t('adminForm.agentAutoFailed'));
    } finally {
        autoConfigLoading.value = false;
    }
}

async function save() {
    if (!form.name.trim()) {
        formError.value = t('adminForm.requiredName');
        return;
    }
    formError.value = '';
    saving.value = true;
    try {
        const body = { ...form, providerId: form.providerId || null };
        if (editing.value?.id) {
            await $fetch(`/api/admin/agents/${editing.value.id}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/agents', { method: 'POST', body });
        }
    } catch (e) {
        formError.value = extractApiError(e, t('adminForm.saveFailed'));
        return;
    } finally {
        saving.value = false;
    }
    editing.value = null;
    await load();
}

async function remove(id: string) {
    if (!confirm(t('adminForm.agentDeleteConfirm'))) return;
    listError.value = '';
    try {
        await $fetch(`/api/admin/agents/${id}`, { method: 'DELETE' });
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
            <h1 class="text-2xl font-bold text-gray-800">{{ t('adminForm.agentTitle') }}</h1>
            <div class="flex items-center gap-2">
                <button
                    class="flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-100"
                    @click="autoConfigModalOpen = true"
                >
                    <span>✨</span> {{ t('adminForm.agentAutoTitle') }}
                </button>
                <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">
                    {{ t('adminForm.agentNew') }}
                </button>
            </div>
        </div>

        <div v-if="editing !== null" class="mb-6 space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <div class="grid grid-cols-2 gap-3">
                <input v-model="form.name" :placeholder="t('adminForm.namePlaceholder')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input v-model="form.emoji" :placeholder="t('adminForm.agentEmojiPlaceholder')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <input v-model="form.description" :placeholder="t('adminForm.description')" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <textarea
                v-model="form.systemPrompt"
                :placeholder="t('adminForm.systemPrompt')"
                rows="3"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="mb-1 block text-xs text-gray-400">{{ t('adminForm.provider') }}</label>
                    <select v-model="form.providerId" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option value="">{{ t('adminForm.defaultProvider') }}</option>
                        <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.name }}</option>
                    </select>
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-400">{{ t('adminForm.model') }}</label>
                    <input
                        v-model="form.model"
                        list="provider-models"
                        :placeholder="t('adminForm.modelIdPlaceholder')"
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
                    <label class="mb-1 block text-xs text-gray-400">{{ t('adminForm.maxTokensOptional') }}</label>
                    <input
                        v-model.number="form.maxTokens"
                        type="number"
                        min="1"
                        :placeholder="t('adminForm.unlimitedPlaceholder')"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
                    />
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-400">{{ t('adminForm.maxStepsLabel') }}</label>
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
                <label class="flex items-center gap-1"><input v-model="form.enabled" type="checkbox" /> {{ t('adminForm.enable') }}</label>
                <label class="flex items-center gap-1">
                    <input v-model="form.selfConfig" type="checkbox" />
                    {{ t('adminForm.agentSelfConfigHint') }}
                </label>
            </div>
            <div>
                <p class="mb-1 text-sm text-gray-600">{{ t('adminForm.agentBindSkill') }}</p>
                <div class="flex flex-wrap gap-2">
                    <label v-for="s in skillList" :key="s.id" class="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                        <input v-model="form.skillIds" type="checkbox" :value="s.id" />
                        {{ s.name }}
                    </label>
                </div>
            </div>
            <div>
                <p class="mb-1 text-sm text-gray-600">{{ t('adminForm.agentBindTool') }}</p>
                <div class="flex flex-wrap gap-2">
                    <!-- 循环变量命名为 tool 而非 t：避免遮蔽 i18n 的 t() 函数 -->
                    <label v-for="tool in toolList" :key="tool.id" class="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                        <input v-model="form.toolIds" type="checkbox" :value="tool.id" />
                        {{ tool.name }}
                        <span class="text-[10px] text-gray-400">{{ tool.type === 'http' ? 'HTTP' : t('adminForm.builtinTag') }}</span>
                    </label>
                    <span v-if="!toolList.length" class="text-xs text-gray-400">{{ t('adminForm.agentNoTools') }}</span>
                </div>
            </div>
            <div>
                <p class="mb-1 text-sm text-gray-600">{{ t('adminForm.agentBindKb') }}</p>
                <div class="flex flex-wrap gap-2">
                    <label v-for="kb in kbList" :key="kb.id" class="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                        <input v-model="form.kbIds" type="checkbox" :value="kb.id" />
                        {{ kb.name }}
                    </label>
                    <span v-if="!kbList.length" class="text-xs text-gray-400">{{ t('adminForm.agentNoKb') }}</span>
                </div>
            </div>
            <div>
                <p class="mb-1 text-sm text-gray-600">{{ t('adminForm.agentBindMcp') }}</p>
                <div class="flex flex-wrap gap-2">
                    <label v-for="m in mcpList" :key="m.id" class="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                        <input v-model="form.mcpIds" type="checkbox" :value="m.id" />
                        {{ m.name }}
                    </label>
                    <span v-if="!mcpList.length" class="text-xs text-gray-400">{{ t('adminForm.agentNoMcp') }}</span>
                </div>
            </div>
            <p v-if="formError" class="text-sm text-red-500">{{ formError }}</p>
            <div class="flex gap-2">
                <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50" :disabled="saving" @click="save">
                    {{ t('adminForm.save') }}
                </button>
                <button class="rounded-lg bg-gray-100 px-4 py-1.5 text-sm" @click="editing = null">{{ t('adminForm.cancel') }}</button>
            </div>
        </div>

        <table class="w-full rounded-2xl bg-white text-sm shadow-sm">
            <thead class="text-left text-gray-400">
                <tr>
                    <th class="p-4">{{ t('adminForm.colAgent') }}</th>
                    <th class="p-4">{{ t('adminForm.colModel') }}</th>
                    <th class="p-4">Skills</th>
                    <th class="p-4">Tools</th>
                    <th class="p-4">{{ t('adminForm.colKnowledge') }}</th>
                    <th class="p-4">{{ t('adminForm.status') }}</th>
                    <th class="p-4">{{ t('adminForm.actions') }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="a in agents" :key="a.id" class="border-t border-gray-100">
                    <td class="p-4">
                        <p class="font-medium text-gray-800">
                            {{ a.emoji || a.avatar || '🤖' }} {{ a.name }}
                            <span
                                v-if="a.selfConfig"
                                class="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-600"
                                :title="t('adminForm.agentSelfConfigHint')"
                            >
                                {{ t('adminForm.agentSelfConfigBadge') }}
                            </span>
                        </p>
                        <p class="text-xs text-gray-400">{{ a.description }}</p>
                    </td>
                    <td class="p-4 font-mono text-xs text-gray-500">{{ a.provider?.name ?? t('adminForm.defaultProvider') }} / {{ a.model }}</td>
                    <td class="p-4">
                        <span v-for="s in a.skills" :key="s.id" class="mr-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                            {{ s.name }}
                        </span>
                        <span v-if="!a.skills?.length" class="text-xs text-gray-300">-</span>
                    </td>
                    <td class="p-4">
                        <span v-for="tool in a.tools" :key="tool.id" class="mr-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">
                            {{ tool.name }}
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
                        <span :class="a.enabled ? 'text-green-600' : 'text-gray-400'">
                            {{ a.enabled ? t('common.enabled') : t('common.disabled') }}
                        </span>
                    </td>
                    <td class="space-x-2 p-4">
                        <button class="text-green-600 hover:underline" @click="openEdit(a)">{{ t('adminForm.edit') }}</button>
                        <button class="text-red-500 hover:underline" @click="remove(a.id)">{{ t('adminForm.delete') }}</button>
                    </td>
                </tr>
                <tr v-if="!agents.length">
                    <td colspan="7" class="p-8 text-center text-gray-400">{{ t('adminForm.agentEmpty') }}</td>
                </tr>
            </tbody>
        </table>

        <!-- AI Auto-Config Modal -->
        <div v-if="autoConfigModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
            <div class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
                <div class="mb-4 flex items-center justify-between">
                    <h3 class="flex items-center gap-2 text-lg font-bold text-gray-800"><span>✨</span> {{ t('adminForm.agentAutoTitle') }}</h3>
                    <button class="text-gray-400 hover:text-gray-600" @click="autoConfigModalOpen = false">✕</button>
                </div>
                <p class="mb-3 text-xs text-gray-500">
                    {{ t('adminForm.agentAutoDesc') }}
                </p>
                <textarea
                    v-model="autoConfigPrompt"
                    rows="4"
                    :placeholder="t('adminForm.agentAutoPlaceholder')"
                    class="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-purple-500 focus:outline-none"
                />
                <p v-if="autoConfigError" class="mt-2 text-xs text-red-500">{{ autoConfigError }}</p>
                <div class="mt-4 flex justify-end gap-2">
                    <button
                        class="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-600 hover:bg-gray-200"
                        :disabled="autoConfigLoading"
                        @click="autoConfigModalOpen = false"
                    >
                        {{ t('adminForm.cancel') }}
                    </button>
                    <button
                        class="flex items-center gap-1.5 rounded-lg bg-purple-600 px-5 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                        :disabled="autoConfigLoading || !autoConfigPrompt.trim()"
                        @click="handleAutoConfig"
                    >
                        <span v-if="autoConfigLoading" class="animate-spin">🔄</span>
                        <span>{{ autoConfigLoading ? t('adminForm.agentAutoGenerating') : t('adminForm.agentAutoGenerate') }}</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
