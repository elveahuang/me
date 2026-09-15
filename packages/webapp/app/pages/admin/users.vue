<script setup lang="ts">
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

interface AdminUser {
    id: string;
    name: string;
    email: string;
    role: string;
    banned: boolean | null;
    createdAt: string;
}

const users = ref<AdminUser[]>([]);
const q = ref('');
const loading = ref(true);

async function load() {
    loading.value = true;
    try {
        const res = await $fetch<{ users: AdminUser[] }>('/api/admin/users', {
            query: { q: q.value || undefined },
        });
        users.value = res.users ?? (res as unknown as AdminUser[]);
    } finally {
        loading.value = false;
    }
}

onMounted(load);

async function action(userId: string, act: string, extra?: Record<string, unknown>) {
    await ($fetch as any)('/api/admin/users/action', {
        method: 'POST',
        body: { userId, action: act, ...extra },
    });
    await load();
}

async function setRole(userId: string, event: Event) {
    const role = (event.target as HTMLSelectElement).value as 'admin' | 'editor' | 'user';
    await action(userId, 'set-role', { role });
}

async function removeUser(userId: string) {
    if (!confirm('确认删除该用户账号？')) return;
    await $fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    await load();
}
</script>

<template>
    <div class="space-y-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <h1 class="text-2xl font-black tracking-tight text-slate-900">{{ t('nav.users') }}</h1>
                <p class="mt-1 text-xs text-slate-500">管理用户凭据、身份角色授权与账号封禁状态</p>
            </div>
            <div class="flex items-center gap-2">
                <input
                    v-model="q"
                    placeholder="按邮箱搜索用户…"
                    class="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs shadow-2xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    @keyup.enter="load"
                />
                <button
                    class="rounded-xl bg-slate-100 px-4 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition-colors hover:bg-slate-200"
                    @click="load"
                >
                    {{ t('common.search') }}
                </button>
            </div>
        </div>

        <div class="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xs">
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-50 text-[11px] font-bold text-slate-400 uppercase">
                        <tr>
                            <th class="p-4">用户</th>
                            <th class="p-4">邮箱</th>
                            <th class="p-4">角色权限</th>
                            <th class="p-4">状态</th>
                            <th class="p-4">注册时间</th>
                            <th class="p-4 text-right">{{ t('common.actions') }}</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 text-slate-700">
                        <tr v-for="u in users" :key="u.id" class="transition-colors hover:bg-slate-50/60">
                            <td class="p-4">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800"
                                    >
                                        {{ u.name?.[0]?.toUpperCase() || 'U' }}
                                    </div>
                                    <span class="font-bold text-slate-900">{{ u.name }}</span>
                                </div>
                            </td>
                            <td class="p-4 font-medium text-slate-600">{{ u.email }}</td>
                            <td class="p-4">
                                <select
                                    :value="u.role"
                                    class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold shadow-2xs outline-none"
                                    @change="setRole(u.id, $event)"
                                >
                                    <option value="user">User（普通）</option>
                                    <option value="editor">Editor（运营）</option>
                                    <option value="admin">Admin（管理）</option>
                                </select>
                            </td>
                            <td class="p-4">
                                <span
                                    :class="[
                                        'rounded-full px-2.5 py-0.5 text-[10px] font-bold',
                                        u.banned ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700',
                                    ]"
                                >
                                    {{ u.banned ? '已封禁' : '正常' }}
                                </span>
                            </td>
                            <td class="p-4 whitespace-nowrap text-slate-400">{{ new Date(u.createdAt).toLocaleDateString() }}</td>
                            <td class="space-x-2 p-4 text-right">
                                <button v-if="!u.banned" class="font-bold text-amber-600 hover:text-amber-700" @click="action(u.id, 'ban')">封禁</button>
                                <button v-else class="font-bold text-emerald-600 hover:text-emerald-700" @click="action(u.id, 'unban')">解封</button>
                                <button class="font-medium text-rose-500 hover:text-rose-700" @click="removeUser(u.id)">
                                    {{ t('common.delete') }}
                                </button>
                            </td>
                        </tr>
                        <tr v-if="!users.length && !loading">
                            <td colspan="6" class="p-12 text-center text-xs text-slate-400">{{ t('admin.tableEmpty') }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>
