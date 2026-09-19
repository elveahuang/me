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
            $fetch<SkillItem[]>('/api/admin/skills'),
            $fetch<{ id: string; name: string; type: string; enabled: boolean }[]>('/api/admin/tools'),
            $fetch<KbItem[]>('/api/admin/knowledge-bases'),
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
    if (saving.value) return;
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
        <div v-if="listError" class="app-alert app-alert-danger mb-4">
            {{ listError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div class="app-page-header !mb-0">
            <div>
                <h1 class="app-page-title text-strong">{{ t('adminForm.agentTitle') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.agentSubtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <button class="app-btn app-btn-outline" @click="autoConfigModalOpen = true">
                    <span aria-hidden="true">✨</span> {{ t('adminForm.agentAutoTitle') }}
                </button>
                <button class="app-btn app-btn-primary" @click="openCreate">{{ t('adminForm.agentNew') }}</button>
            </div>
        </div>

        <AdminDrawer
            :open="editing !== null"
            :title="editing?.id ? t('common.edit') : t('adminForm.agentNew')"
            width-class="sm:max-w-2xl"
            @close="editing = null"
        >
            <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <input v-model="form.name" :placeholder="t('adminForm.namePlaceholder')" class="app-input" />
                    <input v-model="form.emoji" :placeholder="t('adminForm.agentEmojiPlaceholder')" class="app-input" />
                </div>
                <input v-model="form.description" :placeholder="t('adminForm.description')" class="app-input" />
                <textarea v-model="form.systemPrompt" :placeholder="t('adminForm.systemPrompt')" rows="3" class="app-input" />
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="app-label">{{ t('adminForm.provider') }}</label>
                        <select v-model="form.providerId" class="app-input">
                            <option value="">{{ t('adminForm.defaultProvider') }}</option>
                            <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.name }}</option>
                        </select>
                    </div>
                    <div>
                        <label class="app-label">{{ t('adminForm.model') }}</label>
                        <input
                            v-model="form.model"
                            list="provider-models"
                            :placeholder="t('adminForm.modelIdPlaceholder')"
                            class="app-input !font-mono !text-xs"
                        />
                        <datalist id="provider-models">
                            <option v-for="m in selectedProviderModels" :key="m" :value="m" />
                        </datalist>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-3">
                    <div>
                        <label class="app-label">Temperature (0.0 ~ 2.0)</label>
                        <input v-model.number="form.temperature" type="number" step="0.1" min="0" max="2" placeholder="0.7" class="app-input !font-mono" />
                    </div>
                    <div>
                        <label class="app-label">{{ t('adminForm.maxTokensOptional') }}</label>
                        <input
                            v-model.number="form.maxTokens"
                            type="number"
                            min="1"
                            :placeholder="t('adminForm.unlimitedPlaceholder')"
                            class="app-input !font-mono"
                        />
                    </div>
                    <div>
                        <label class="app-label">{{ t('adminForm.maxStepsLabel') }}</label>
                        <input v-model.number="form.maxSteps" type="number" min="1" max="30" placeholder="6" class="app-input !font-mono" />
                    </div>
                </div>
                <div class="text-soft flex items-center gap-4 text-sm">
                    <label class="flex items-center gap-1.5">
                        <input v-model="form.enabled" type="checkbox" class="app-checkbox" />
                        {{ t('adminForm.enable') }}
                    </label>
                    <label class="flex items-center gap-1.5">
                        <input v-model="form.selfConfig" type="checkbox" class="app-checkbox" />
                        {{ t('adminForm.agentSelfConfigHint') }}
                    </label>
                </div>
                <div>
                    <p class="app-label">{{ t('adminForm.agentBindSkill') }}</p>
                    <div class="flex flex-wrap gap-2">
                        <label v-for="s in skillList" :key="s.id" class="app-chip cursor-pointer" :class="form.skillIds.includes(s.id) ? 'app-chip-brand' : ''">
                            <input v-model="form.skillIds" type="checkbox" :value="s.id" class="app-checkbox" />
                            {{ s.name }}
                        </label>
                    </div>
                </div>
                <div>
                    <p class="app-label">{{ t('adminForm.agentBindTool') }}</p>
                    <div class="flex flex-wrap gap-2">
                        <!-- 循环变量命名为 tool 而非 t：避免遮蔽 i18n 的 t() 函数 -->
                        <label
                            v-for="tool in toolList"
                            :key="tool.id"
                            class="app-chip cursor-pointer"
                            :class="form.toolIds.includes(tool.id) ? 'app-chip-brand' : ''"
                        >
                            <input v-model="form.toolIds" type="checkbox" :value="tool.id" class="app-checkbox" />
                            {{ tool.name }}
                            <span class="text-faint !text-[10px]">{{ tool.type === 'http' ? 'HTTP' : t('adminForm.builtinTag') }}</span>
                        </label>
                        <span v-if="!toolList.length" class="text-faint text-xs">{{ t('adminForm.agentNoTools') }}</span>
                    </div>
                </div>
                <div>
                    <p class="app-label">{{ t('adminForm.agentBindKb') }}</p>
                    <div class="flex flex-wrap gap-2">
                        <label v-for="kb in kbList" :key="kb.id" class="app-chip cursor-pointer" :class="form.kbIds.includes(kb.id) ? 'app-chip-brand' : ''">
                            <input v-model="form.kbIds" type="checkbox" :value="kb.id" class="app-checkbox" />
                            {{ kb.name }}
                        </label>
                        <span v-if="!kbList.length" class="text-faint text-xs">{{ t('adminForm.agentNoKb') }}</span>
                    </div>
                </div>
                <div>
                    <p class="app-label">{{ t('adminForm.agentBindMcp') }}</p>
                    <div class="flex flex-wrap gap-2">
                        <label v-for="m in mcpList" :key="m.id" class="app-chip cursor-pointer" :class="form.mcpIds.includes(m.id) ? 'app-chip-brand' : ''">
                            <input v-model="form.mcpIds" type="checkbox" :value="m.id" class="app-checkbox" />
                            {{ m.name }}
                        </label>
                        <span v-if="!mcpList.length" class="text-faint text-xs">{{ t('adminForm.agentNoMcp') }}</span>
                    </div>
                </div>
                <p v-if="formError" class="app-help-error text-sm">{{ formError }}</p>
            </div>
            <template #footer>
                <button class="app-btn app-btn-ghost" :disabled="saving" @click="editing = null">{{ t('adminForm.cancel') }}</button>
                <button class="app-btn app-btn-primary" :disabled="saving" @click="save">{{ t('adminForm.save') }}</button>
            </template>
        </AdminDrawer>

        <div class="app-table-wrap">
            <table class="app-table">
                <thead>
                    <tr>
                        <th>{{ t('adminForm.colAgent') }}</th>
                        <th>{{ t('adminForm.colModel') }}</th>
                        <th>Skills</th>
                        <th>Tools</th>
                        <th>{{ t('adminForm.colKnowledge') }}</th>
                        <th>{{ t('adminForm.status') }}</th>
                        <th class="text-right">{{ t('adminForm.actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="a in agents" :key="a.id">
                        <td class="app-table-cell-wrap">
                            <p class="text-strong font-medium">
                                <span aria-hidden="true">{{ a.emoji || a.avatar || '🤖' }}</span> {{ a.name }}
                                <span v-if="a.selfConfig" class="app-badge app-badge-info ml-1" :title="t('adminForm.agentSelfConfigHint')">
                                    {{ t('adminForm.agentSelfConfigBadge') }}
                                </span>
                            </p>
                            <p class="text-faint text-xs">{{ a.description }}</p>
                        </td>
                        <td class="app-table-cell-wrap text-muted-2 font-mono text-xs">
                            {{ a.provider?.name ?? t('adminForm.defaultProvider') }} / {{ a.model }}
                        </td>
                        <td>
                            <span v-for="s in a.skills" :key="s.id" class="app-chip mr-1">{{ s.name }}</span>
                            <span v-if="!a.skills?.length" class="text-faint">-</span>
                        </td>
                        <td>
                            <span v-for="tool in a.tools" :key="tool.id" class="app-chip mr-1">{{ tool.name }}</span>
                            <span v-if="!a.tools?.length" class="text-faint">-</span>
                        </td>
                        <td>
                            <span v-for="kb in a.knowledgeBases" :key="kb.id" class="app-chip mr-1">{{ kb.name }}</span>
                            <span v-if="!a.knowledgeBases?.length" class="text-faint">-</span>
                        </td>
                        <td>
                            <span :class="a.enabled ? 'app-badge-success' : 'app-badge-neutral'" class="app-badge">
                                {{ a.enabled ? t('common.enabled') : t('common.disabled') }}
                            </span>
                        </td>
                        <td>
                            <div class="app-table-actions">
                                <button class="app-btn app-btn-soft app-btn-sm" @click="openEdit(a)">{{ t('adminForm.edit') }}</button>
                                <button class="app-btn app-btn-danger app-btn-sm" @click="remove(a.id)">{{ t('adminForm.delete') }}</button>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="!agents.length">
                        <td colspan="7" class="!whitespace-normal">
                            <div class="app-empty">
                                <span class="app-empty-icon">🤖</span>
                                <p class="app-empty-title">{{ t('adminForm.agentEmpty') }}</p>
                                <p class="app-empty-desc">{{ t('adminForm.agentSubtitle') }}</p>
                                <div class="mt-2 flex gap-2">
                                    <button class="app-btn app-btn-outline app-btn-sm" @click="autoConfigModalOpen = true">
                                        <span aria-hidden="true">✨</span> {{ t('adminForm.agentAutoTitle') }}
                                    </button>
                                    <button class="app-btn app-btn-primary app-btn-sm" @click="openCreate">{{ t('adminForm.agentNew') }}</button>
                                </div>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- AI Auto-Config Modal -->
        <div v-if="autoConfigModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--overlay)] p-4 backdrop-blur-xs">
            <div class="app-card w-full max-w-lg p-6 !shadow-xl">
                <div class="mb-4 flex items-center justify-between">
                    <h3 class="text-strong flex items-center gap-2 text-lg font-bold">
                        <span aria-hidden="true">✨</span> {{ t('adminForm.agentAutoTitle') }}
                    </h3>
                    <button type="button" class="text-faint text-hover-strong" @click="autoConfigModalOpen = false">✕</button>
                </div>
                <p class="text-muted-2 mb-3 text-xs">
                    {{ t('adminForm.agentAutoDesc') }}
                </p>
                <textarea v-model="autoConfigPrompt" rows="4" :placeholder="t('adminForm.agentAutoPlaceholder')" class="app-input" />
                <p v-if="autoConfigError" class="app-help-error mt-2 text-xs">{{ autoConfigError }}</p>
                <div class="mt-4 flex justify-end gap-2">
                    <button class="app-btn app-btn-ghost" :disabled="autoConfigLoading" @click="autoConfigModalOpen = false">
                        {{ t('adminForm.cancel') }}
                    </button>
                    <button class="app-btn app-btn-primary" :disabled="autoConfigLoading || !autoConfigPrompt.trim()" @click="handleAutoConfig">
                        <span v-if="autoConfigLoading" class="animate-spin">🔄</span>
                        <span>{{ autoConfigLoading ? t('adminForm.agentAutoGenerating') : t('adminForm.agentAutoGenerate') }}</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
