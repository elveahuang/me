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
const editing = ref<Partial<SkillItem> | null>(null);
const formError = ref('');
const error = ref('');
const success = ref('');
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
    error.value = '';
    try {
        skills.value = await $fetch<SkillItem[]>('/api/admin/skills');
    } catch (e) {
        skills.value = [];
        fail(e, t('adminForm.skillLoadFailed'));
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
            await $fetch(`/api/admin/skills/${editing.value.id}`, { method: 'PATCH', body });
        } else {
            await $fetch('/api/admin/skills', { method: 'POST', body });
        }
        editing.value = null;
        success.value = t('adminForm.savedOk');
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
        await $fetch(`/api/admin/skills/${skill.id}`, { method: 'PATCH', body: { enabled: !skill.enabled } });
        await load();
    } catch (e) {
        fail(e, t('adminForm.skillToggleFailed'));
    }
}

async function remove(id: string) {
    if (!confirm(t('adminForm.skillDeleteConfirm'))) return;
    error.value = '';
    try {
        await $fetch(`/api/admin/skills/${id}`, { method: 'DELETE' });
        success.value = t('adminForm.deletedOk');
        await load();
    } catch (e) {
        fail(e, t('adminForm.deleteFailed'));
    }
}
</script>

<template>
    <div>
        <div v-if="error" class="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div v-if="success" class="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{{ success }}</div>
        <div class="mb-6 flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">{{ t('adminForm.skillTitle') }}</h1>
                <p class="mt-1 text-xs text-gray-400">{{ t('adminForm.skillSubtitle') }}</p>
            </div>
            <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">{{ t('adminForm.skillNew') }}</button>
        </div>

        <div v-if="editing !== null" class="mb-6 space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <div class="grid grid-cols-2 gap-3">
                <input v-model="form.name" :placeholder="t('adminForm.skillNamePlaceholder')" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input
                    v-model="form.description"
                    :placeholder="t('adminForm.skillDescriptionPlaceholder')"
                    class="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
            </div>
            <textarea
                v-model="form.instructions"
                rows="8"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                :placeholder="t('adminForm.skillInstructionsPlaceholder')"
            />
            <label class="flex items-center gap-1 text-sm text-gray-600"> <input v-model="form.enabled" type="checkbox" /> {{ t('adminForm.enable') }} </label>
            <p v-if="formError" class="text-sm text-red-500">{{ formError }}</p>
            <div class="flex gap-2">
                <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50" :disabled="saving" @click="save">
                    {{ t('adminForm.save') }}
                </button>
                <button class="rounded-lg bg-gray-100 px-4 py-1.5 text-sm" :disabled="saving" @click="editing = null">{{ t('adminForm.cancel') }}</button>
            </div>
        </div>

        <table class="w-full rounded-2xl bg-white text-sm shadow-sm">
            <thead class="text-left text-gray-400">
                <tr>
                    <th class="p-4">Skill</th>
                    <th class="p-4">{{ t('adminForm.skillColInstructions') }}</th>
                    <th class="p-4">{{ t('adminForm.status') }}</th>
                    <th class="p-4">{{ t('adminForm.actions') }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="s in skills" :key="s.id" class="border-t border-gray-100">
                    <td class="p-4">
                        <p class="font-medium text-gray-800">{{ s.name }}</p>
                        <p class="text-xs text-gray-400">{{ s.description }}</p>
                    </td>
                    <td class="max-w-md p-4">
                        <p class="truncate text-xs text-gray-500">{{ s.instructions || t('adminForm.skillInstructionsEmpty') }}</p>
                    </td>
                    <td class="p-4">
                        <button :class="s.enabled ? 'text-green-600' : 'text-gray-400'" @click="toggle(s)">
                            {{ s.enabled ? t('common.enabled') : t('common.disabled') }}
                        </button>
                    </td>
                    <td class="space-x-2 p-4">
                        <button class="text-green-600 hover:underline" @click="openEdit(s)">{{ t('adminForm.edit') }}</button>
                        <button class="text-red-500 hover:underline" @click="remove(s.id)">{{ t('adminForm.delete') }}</button>
                    </td>
                </tr>
                <tr v-if="!skills.length">
                    <td colspan="4" class="p-8 text-center text-gray-400">{{ t('adminForm.skillEmpty') }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
