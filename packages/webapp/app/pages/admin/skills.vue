<script setup lang="ts">
import { extractApiError } from '@commons/contract';

definePageMeta({ layout: 'admin', middleware: 'admin' });

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

/** 列表级错误提示（表单错误仍走 formError，避免互相覆盖） */
function fail(e: unknown, fallback = '操作失败') {
    success.value = '';
    error.value = extractApiError(e, fallback);
}

async function load() {
    error.value = '';
    try {
        skills.value = await $fetch<SkillItem[]>('/api/admin/skills');
    } catch (e) {
        skills.value = [];
        fail(e, '加载 Skill 列表失败');
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
        formError.value = '名称必填';
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
        success.value = '已保存';
        await load();
    } catch (e) {
        formError.value = extractApiError(e, '保存失败');
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
        fail(e, '切换状态失败');
    }
}

async function remove(id: string) {
    if (!confirm('确认删除该 Skill？')) return;
    error.value = '';
    try {
        await $fetch(`/api/admin/skills/${id}`, { method: 'DELETE' });
        success.value = '已删除';
        await load();
    } catch (e) {
        fail(e, '删除失败');
    }
}
</script>

<template>
    <div>
        <div v-if="error" class="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">重试</button>
        </div>
        <div v-if="success" class="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{{ success }}</div>
        <div class="mb-6 flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">Skill 管理</h1>
                <p class="mt-1 text-xs text-gray-400">
                    Skill 是可复用的指令块（不可执行）。挂载到智能体后，其指令会注入系统提示词。需要调用外部能力请使用 Tool。
                </p>
            </div>
            <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700" @click="openCreate">新建 Skill</button>
        </div>

        <div v-if="editing !== null" class="mb-6 space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <div class="grid grid-cols-2 gap-3">
                <input v-model="form.name" placeholder="名称，如：结构化输出规范" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input v-model="form.description" placeholder="描述（管理端备注，不影响提示词）" class="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <textarea
                v-model="form.instructions"
                rows="8"
                class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="指令内容，会注入系统提示词。支持 {{user_name}} {{current_date}} 等模版变量"
            />
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
                    <th class="p-4">Skill</th>
                    <th class="p-4">指令预览</th>
                    <th class="p-4">状态</th>
                    <th class="p-4">操作</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="s in skills" :key="s.id" class="border-t border-gray-100">
                    <td class="p-4">
                        <p class="font-medium text-gray-800">{{ s.name }}</p>
                        <p class="text-xs text-gray-400">{{ s.description }}</p>
                    </td>
                    <td class="max-w-md p-4">
                        <p class="truncate text-xs text-gray-500">{{ s.instructions || '（空）' }}</p>
                    </td>
                    <td class="p-4">
                        <button :class="s.enabled ? 'text-green-600' : 'text-gray-400'" @click="toggle(s)">
                            {{ s.enabled ? '启用' : '停用' }}
                        </button>
                    </td>
                    <td class="space-x-2 p-4">
                        <button class="text-green-600 hover:underline" @click="openEdit(s)">编辑</button>
                        <button class="text-red-500 hover:underline" @click="remove(s.id)">删除</button>
                    </td>
                </tr>
                <tr v-if="!skills.length">
                    <td colspan="4" class="p-8 text-center text-gray-400">暂无 Skill</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
