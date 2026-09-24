<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

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

const form = reactive({
    name: '',
    description: '',
    instructions: '',
    enabled: true,
});

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
        skills.value = await $fetch<SkillItem[]>('/api/admin/skills');
    } catch (e) {
        skills.value = [];
        fail(e, t('adminForm.skillLoadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

function openCreate() {
    editing.value = {};
    Object.assign(form, { name: '', description: '', instructions: '', enabled: true });
    formError.value = '';
}

function openEdit(skill: SkillItem) {
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
    try {
        const body = {
            name: form.name,
            description: form.description,
            instructions: form.instructions,
            enabled: form.enabled,
        };
        if (editing.value?.id) {
            await $fetch(`/api/admin/skills/${encodeURIComponent(editing.value.id)}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/skills', { method: 'POST', body });
        }
        editing.value = null;
        flashSuccess(t('adminForm.savedOk'));
        await load();
    } catch (e) {
        formError.value = extractApiError(e, t('adminForm.saveFailed'));
    } finally {
        saving.value = false;
    }
}

async function toggle(skill: SkillItem) {
    error.value = '';
    try {
        await $fetch(`/api/admin/skills/${encodeURIComponent(skill.id)}`, { method: 'PATCH', body: { enabled: !skill.enabled } });
        await load();
    } catch (e) {
        fail(e, t('adminForm.skillToggleFailed'));
    }
}

async function remove(id: string) {
    if (!confirm(t('adminForm.skillDeleteConfirm'))) return;
    error.value = '';
    try {
        await $fetch(`/api/admin/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
                <h1 class="app-page-title text-strong">{{ t('adminForm.skillTitle') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.skillSubtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <button class="app-btn app-btn-primary app-btn-sm" @click="openCreate">{{ t('adminForm.skillNew') }}</button>
            </div>
        </div>

        <AdminDrawer :open="editing !== null" :title="editing?.id ? t('common.edit') : t('adminForm.skillNew')" @close="editing = null">
            <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
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
                <button class="app-btn app-btn-ghost" :disabled="saving" @click="editing = null">{{ t('adminForm.cancel') }}</button>
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
                    <tr v-if="!skills.length">
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
