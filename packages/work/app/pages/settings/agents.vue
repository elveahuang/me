<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

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
const loading = ref(true);
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
/** 弹层面板：Esc 关闭、Tab 焦点圈闭、滚动锁与焦点归还统一走 useDrawerFocus（与 AdminDrawer 同一套行为） */
const autoConfigPanel = ref<HTMLElement | null>(null);
useDrawerFocus(
    () => autoConfigModalOpen.value,
    autoConfigPanel,
    () => {
        autoConfigModalOpen.value = false;
    },
);
// 关闭时清掉上一次的错误：留着的话下次打开弹窗会先看到一条与本次输入无关的失败原因
watch(autoConfigModalOpen, (open) => {
    if (!open) autoConfigError.value = '';
});
/**
 * 「这次生成的结果还归这个表单吗」的令牌。
 *
 * AI 生成配置是一条最长可跑 120 秒的请求，而弹窗头部的 ✕ 不随 loading 禁用，所以期间完全可以
 * 回到列表点某条已有智能体的「编辑」。迟到的响应会把 editing 置成 {} 并整表覆盖 form——
 * 抽屉的 :open 绑的就是 editing !== null，于是它凭空弹回来、里面装的是生成结果而不是用户
 * 正在改的那条；此时点保存走 POST（editing.id 为空），变成「凭空新建一个智能体」且原编辑丢失。
 * 每次改写表单的动作换发新令牌，生成结果落地前比对即可作废。
 */
let formOwner = 0;

/** 关闭表单抽屉：令牌一并作废——在途保存的失败提示不能写进一个已经关掉的抽屉 */
function closeAgentDrawer() {
    formOwner += 1;
    saving.value = false;
    editing.value = null;
}

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

/**
 * 换供应商时把模型换成新供应商名下的一个。
 *
 * 模型 id 只在所属供应商内有效：从 A 切到 B 却留着 A 的 id，表单看起来一切正常，保存后这个智能体
 * 每轮都报「模型不可用」。只在模型不属于新供应商的候选时才替换——用户手填的自定义模型不动。
 */
function onProviderChange() {
    const models = providerList.value.find((x) => x.id === form.providerId)?.models ?? [];
    if (!models.length) return;
    if (form.model && models.includes(form.model)) return;
    form.model = models[0]!;
}

/** 表单一动，上一次保存失败的原因就不再成立；留着会让用户以为这次的改动也被拒了 */
watch(form, () => (formError.value = ''), { deep: true });

async function load() {
    loading.value = true;
    listError.value = '';
    try {
        const [agentRows, skills, tools, kbs, mcps, providers] = await Promise.all([
            $fetch<AgentItem[]>('/api/settings/agents'),
            $fetch<SkillItem[]>('/api/settings/skills'),
            $fetch<{ id: string; name: string; type: string; enabled: boolean }[]>('/api/settings/tools'),
            $fetch<KbItem[]>('/api/settings/knowledge-bases'),
            $fetch<{ id: string; name: string; enabled: boolean }[]>('/api/settings/mcp-servers'),
            $fetch<ProviderItem[]>('/api/settings/providers'),
        ]);
        agents.value = agentRows;
        skillList.value = skills;
        toolList.value = tools.filter((tool) => tool.enabled);
        kbList.value = kbs;
        mcpList.value = mcps.filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name }));
        providerList.value = providers.filter((p) => p.enabled);
    } catch (e) {
        // 加载失败必须显式报错并清空列表，否则空数组会渲染成「暂无智能体」，把接口故障读成没有数据
        agents.value = [];
        listError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

function openCreate() {
    formOwner++;
    // 上一张表单的在途保存已经不属于这里，不复位会让新表单的保存按钮一直停在「保存中」
    saving.value = false;
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
    formOwner++;
    saving.value = false;
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
    const owner = ++formOwner;
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
        }>('/api/settings/agents/auto-config', {
            method: 'POST',
            body: { description: autoConfigPrompt.value },
        });

        // 弹窗已被关掉（✕ 不受 loading 约束）或表单已归另一次编辑/新建所有：这一次的结果作废。
        if (!autoConfigModalOpen.value || owner !== formOwner) return;
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
        // 与成功分支同一道归属比对：弹窗已关或表单已归另一次编辑时，这条错误不属于当前界面
        if (!autoConfigModalOpen.value || owner !== formOwner) return;
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
    const owner = formOwner;
    try {
        const body = { ...form, providerId: form.providerId || null };
        if (editing.value?.id) {
            await $fetch(`/api/settings/agents/${encodeURIComponent(editing.value.id)}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/settings/agents', { method: 'POST', body });
        }
    } catch (e) {
        const message = extractApiError(e, t('adminForm.saveFailed'));
        // 保存期间已经改开另一张表单：把这条失败原因写进那张抽屉会被读成本次编辑的问题，
        // 但也不能吞掉——这次保存确实没成功，改挂到页面级错误条上。
        if (owner === formOwner) formError.value = message;
        else listError.value = message;
        return;
    } finally {
        // 令牌已换说明这一轮早已结束、当前是新表单：不能在这里动它的 saving
        if (owner === formOwner) saving.value = false;
    }
    // 保存期间用户可能已关掉抽屉或改开另一条智能体：无条件清空会把他正在填的表单一起关掉。
    // 列表仍要刷新——刚保存的那条已经落库了。
    if (owner === formOwner) editing.value = null;
    await load();
}

async function remove(id: string) {
    if (!confirm(t('adminForm.agentDeleteConfirm'))) return;
    listError.value = '';
    try {
        await $fetch(`/api/settings/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
        // 服务端现在会用 409 拦住「名下还有会话」的删除（会话与消息是 cascade，删掉就永久没了）。
        // 这里问第二遍，确认后才带 force 重试；不确认就当用户改主意，不额外挂错误横幅。
        const status = (e as { status?: number; statusCode?: number }).status ?? (e as { statusCode?: number }).statusCode;
        if (status !== 409) {
            listError.value = extractApiError(e, t('adminForm.deleteFailed'));
            return;
        }
        if (!confirm(t('adminForm.agentForceDeleteConfirm'))) return;
        try {
            await $fetch(`/api/settings/agents/${encodeURIComponent(id)}`, { method: 'DELETE', query: { force: '1' } });
        } catch (retryError) {
            listError.value = extractApiError(retryError, t('adminForm.deleteFailed'));
            return;
        }
    }
    await load();
}
</script>

<template>
    <div>
        <WorkSettingsNav class="mb-5" />
        <div v-if="listError" class="app-alert app-alert-danger mb-4">
            {{ listError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div class="app-page-header !mb-0">
            <div>
                <h1 class="app-page-title text-strong">{{ t('settings.navAgents') }}</h1>
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
            @close="closeAgentDrawer"
        >
            <div class="space-y-3">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input :aria-label="t('adminForm.namePlaceholder')" v-model="form.name" :placeholder="t('adminForm.namePlaceholder')" class="app-input" />
                    <input
                        :aria-label="t('adminForm.agentEmojiPlaceholder')"
                        v-model="form.emoji"
                        :placeholder="t('adminForm.agentEmojiPlaceholder')"
                        class="app-input"
                    />
                </div>
                <input :aria-label="t('adminForm.description')" v-model="form.description" :placeholder="t('adminForm.description')" class="app-input" />
                <textarea
                    :aria-label="t('adminForm.systemPrompt')"
                    v-model="form.systemPrompt"
                    :placeholder="t('adminForm.systemPrompt')"
                    rows="3"
                    class="app-input"
                />
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                        <label class="app-label">{{ t('adminForm.provider') }}</label>
                        <select :aria-label="t('adminForm.provider')" v-model="form.providerId" class="app-input" @change="onProviderChange">
                            <option value="">{{ t('adminForm.defaultProvider') }}</option>
                            <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.name }}</option>
                        </select>
                    </div>
                    <div>
                        <label class="app-label">{{ t('adminForm.model') }}</label>
                        <input
                            :aria-label="t('adminForm.model')"
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
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div>
                        <label class="app-label">{{ t('adminForm.agentTemperature') }}</label>
                        <input
                            :aria-label="t('adminForm.agentTemperature')"
                            v-model.number="form.temperature"
                            type="number"
                            step="0.1"
                            min="0"
                            max="2"
                            placeholder="0.7"
                            class="app-input !font-mono"
                        />
                    </div>
                    <div>
                        <label class="app-label">{{ t('adminForm.maxTokensOptional') }}</label>
                        <input
                            :aria-label="t('adminForm.maxTokensOptional')"
                            v-model.number="form.maxTokens"
                            type="number"
                            min="1"
                            :placeholder="t('adminForm.unlimitedPlaceholder')"
                            class="app-input !font-mono"
                        />
                    </div>
                    <div>
                        <label class="app-label">{{ t('adminForm.maxStepsLabel') }}</label>
                        <input
                            :aria-label="t('adminForm.maxStepsLabel')"
                            v-model.number="form.maxSteps"
                            type="number"
                            min="1"
                            max="30"
                            placeholder="6"
                            class="app-input !font-mono"
                        />
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
                <button class="app-btn app-btn-ghost" :disabled="saving" @click="closeAgentDrawer">{{ t('adminForm.cancel') }}</button>
                <button class="app-btn app-btn-primary" :disabled="saving" @click="save">{{ t('adminForm.save') }}</button>
            </template>
        </AdminDrawer>

        <div v-if="loading" class="space-y-2">
            <div v-for="i in 3" :key="i" class="app-skeleton h-16 !rounded-xl" />
        </div>
        <div v-else class="app-table-wrap">
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
                    <!-- 接口失败时不渲染空态：否则「列表读不到」读成「一个智能体都没有」，
                         而顶部那条错误横幅会被当成又一次抖动忽略掉（与 chat/index.vue 的 !loading && !loadError 同一口径） -->
                    <tr v-if="!listError && !agents.length">
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
        <div
            v-if="autoConfigModalOpen"
            ref="autoConfigPanel"
            class="app-modal-backdrop"
            role="dialog"
            aria-modal="true"
            :aria-label="t('adminForm.agentAutoTitle')"
            @click.self="autoConfigModalOpen = false"
        >
            <div class="app-card w-full max-w-lg p-6 !shadow-xl">
                <div class="mb-4 flex items-center justify-between">
                    <h3 class="text-strong flex items-center gap-2 text-lg font-bold">
                        <span aria-hidden="true">✨</span> {{ t('adminForm.agentAutoTitle') }}
                    </h3>
                    <button type="button" class="text-faint text-hover-strong" :aria-label="t('common.close')" @click="autoConfigModalOpen = false">✕</button>
                </div>
                <p class="text-muted-2 mb-3 text-xs">
                    {{ t('adminForm.agentAutoDesc') }}
                </p>
                <textarea
                    :aria-label="t('adminForm.agentAutoTitle')"
                    v-model="autoConfigPrompt"
                    rows="4"
                    :placeholder="t('adminForm.agentAutoPlaceholder')"
                    class="app-input"
                />
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
