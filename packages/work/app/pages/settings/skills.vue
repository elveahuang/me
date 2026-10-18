<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';
definePageMeta({ layout: 'settings' });

const { t } = useI18n();

interface SkillItem {
    id: string;
    name: string;
    description: string;
    instructions: string;
    enabled: boolean;
}

const skills = ref<SkillItem[]>([]);
const loading = ref(true);
const editing = ref<Partial<SkillItem> | null>(null);
const formError = ref('');
const error = ref('');
const { success, flashSuccess } = useFlashSuccess();
const saving = ref(false);
/** 启停在途标记：PATCH 发的是绝对值，列表刷新前的第二次点击会再发同一个值（与 tasks.vue 同口径） */
const toggling = ref<Set<string>>(new Set());

const form = reactive({
    name: '',
    description: '',
    instructions: '',
    enabled: true,
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

/**
 * 列表级错误提示（表单错误仍走 formError，避免互相覆盖）
 */
function fail(e: unknown, fallback = t('adminForm.operationFailed')) {
    success.value = '';
    error.value = extractApiError(e, fallback);
}

async function load() {
    loading.value = true;
    error.value = '';
    try {
        skills.value = await $fetch<SkillItem[]>('/api/settings/skills');
    } catch (e) {
        skills.value = [];
        fail(e, t('adminForm.skillLoadFailed'));
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
    Object.assign(form, { name: '', description: '', instructions: '', enabled: true });
    formError.value = '';
}

function openEdit(skill: SkillItem) {
    formToken += 1;
    saving.value = false;
    editing.value = skill;
    Object.assign(form, {
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        enabled: skill.enabled,
    });
    formError.value = '';
}

async function save() {
    if (saving.value) return;
    if (!form.name.trim()) {
        formError.value = t('adminForm.requiredName');
        return;
    }
    saving.value = true;
    formError.value = '';
    const token = formToken;
    try {
        const body = {
            name: form.name,
            description: form.description,
            instructions: form.instructions,
            enabled: form.enabled,
        };
        if (editing.value?.id) {
            await $fetch(`/api/settings/skills/${encodeURIComponent(editing.value.id)}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/settings/skills', { method: 'POST', body });
        }
        // 保存期间用户可能已关掉抽屉或改开另一条技能：不能代他把当前这张表单关掉
        if (token === formToken) editing.value = null;
        flashSuccess(t('adminForm.savedOk'));
        await load();
    } catch (e) {
        const failure = extractApiError(e, t('adminForm.saveFailed'));
        // 抽屉已换成另一条技能时，这条失败属于上一条：写进当前表单会被读成本次编辑的问题
        if (token === formToken) formError.value = failure;
        else fail(e, t('adminForm.saveFailed'));
    } finally {
        if (token === formToken) saving.value = false;
    }
}

async function toggle(skill: SkillItem) {
    if (toggling.value.has(skill.id)) return;
    toggling.value = new Set(toggling.value).add(skill.id);
    error.value = '';
    try {
        await $fetch(`/api/settings/skills/${encodeURIComponent(skill.id)}`, { method: 'PATCH', body: { enabled: !skill.enabled } });
        await load();
    } catch (e) {
        fail(e, t('adminForm.skillToggleFailed'));
    } finally {
        const next = new Set(toggling.value);
        next.delete(skill.id);
        toggling.value = next;
    }
}

async function remove(id: string) {
    if (!confirm(t('adminForm.skillDeleteConfirm'))) return;
    error.value = '';
    try {
        await $fetch(`/api/settings/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
        flashSuccess(t('adminForm.deletedOk'));
        await load();
    } catch (e) {
        fail(e, t('adminForm.deleteFailed'));
    }
}
</script>

<template>
    <div class="space-y-6">
        <div v-if="error" class="app-alert app-alert-danger">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div v-if="success" class="app-alert app-alert-success">{{ success }}</div>
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('settings.navSkills') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.skillSubtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <button class="app-btn app-btn-primary app-btn-sm" @click="openCreate">{{ t('adminForm.skillNew') }}</button>
            </div>
        </div>

        <AdminDrawer :open="editing !== null" :title="editing?.id ? t('common.edit') : t('adminForm.skillNew')" @close="closeDrawer">
            <div class="space-y-3">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                        :aria-label="t('adminForm.skillNamePlaceholder')"
                        v-model="form.name"
                        :placeholder="t('adminForm.skillNamePlaceholder')"
                        class="app-input"
                    />
                    <input
                        :aria-label="t('adminForm.skillDescriptionPlaceholder')"
                        v-model="form.description"
                        :placeholder="t('adminForm.skillDescriptionPlaceholder')"
                        class="app-input"
                    />
                </div>
                <textarea
                    :aria-label="t('adminForm.skillInstructionsPlaceholder')"
                    v-model="form.instructions"
                    rows="8"
                    class="app-input"
                    :placeholder="t('adminForm.skillInstructionsPlaceholder')"
                />
                <label class="text-soft flex items-center gap-1.5 text-sm">
                    <input v-model="form.enabled" type="checkbox" class="app-checkbox" /> {{ t('adminForm.enable') }}
                </label>
                <p v-if="formError" class="app-help-error">{{ formError }}</p>
            </div>
            <template #footer>
                <button class="app-btn app-btn-ghost" :disabled="saving" @click="closeDrawer">{{ t('adminForm.cancel') }}</button>
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
                        <th>Skill</th>
                        <th>{{ t('adminForm.skillColInstructions') }}</th>
                        <th>{{ t('adminForm.status') }}</th>
                        <th class="text-right">{{ t('adminForm.actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="s in skills" :key="s.id">
                        <td>
                            <p class="text-strong font-medium">{{ s.name }}</p>
                            <p class="text-faint text-xs">{{ s.description }}</p>
                        </td>
                        <td class="app-table-cell-wrap">
                            <p class="text-muted-2 text-xs">{{ s.instructions || t('adminForm.skillInstructionsEmpty') }}</p>
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
                                <button class="app-btn app-btn-soft app-btn-sm" @click="openEdit(s)">{{ t('adminForm.edit') }}</button>
                                <button class="app-btn app-btn-danger app-btn-sm" @click="remove(s.id)">{{ t('adminForm.delete') }}</button>
                            </div>
                        </td>
                    </tr>
                    <!-- 加载失败时不渲染空态：接口故障不能被读成「没有数据」 -->
                    <tr v-if="!error && !skills.length">
                        <td colspan="4" class="!whitespace-normal">
                            <div class="app-empty">
                                <span class="app-empty-icon">🧩</span>
                                <p class="app-empty-title">{{ t('adminForm.skillEmpty') }}</p>
                                <p class="app-empty-desc">{{ t('adminForm.skillSubtitle') }}</p>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
