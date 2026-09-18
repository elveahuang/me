<script setup lang="ts">
import { extractApiError } from '@commons/contract';
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
const loadError = ref('');
const roleFilter = ref('all');

const filteredUsers = computed(() => {
    let list = users.value;
    if (roleFilter.value !== 'all') {
        list = list.filter((u) => u.role === roleFilter.value);
    }
    const kw = q.value.trim().toLowerCase();
    if (kw) {
        list = list.filter((u) => u.name.toLowerCase().includes(kw) || u.email.toLowerCase().includes(kw));
    }
    return list;
});

const adminCount = computed(() => users.value.filter((u) => u.role === 'admin').length);
const bannedCount = computed(() => users.value.filter((u) => u.banned).length);

async function load() {
    loading.value = true;
    loadError.value = '';
    try {
        const res = await $fetch<{ users: AdminUser[] }>('/api/admin/users');
        users.value = res.users ?? (res as unknown as AdminUser[]);
    } catch (e) {
        // 失败时给出可见提示，避免列表空态被误读为「搜索无结果」
        users.value = [];
        loadError.value = extractApiError(e, t('common.loadFailed'));
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
                <p class="mt-1 text-xs text-slate-500">管理用户凭据、身份角色授权与账号安全治理</p>
            </div>
            <button
                type="button"
                class="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50"
                @click="load"
            >
                🔄 {{ t('common.refresh') }}
            </button>
        </div>

        <!-- 用户指标概览卡片 -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
                <p class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">{{ t('admin.usersCount') }}</p>
                <p class="mt-2 text-2xl font-black text-slate-900">{{ users.length }}</p>
                <p class="mt-1 text-[11px] text-slate-400">已注册账号总量</p>
            </div>
            <div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
                <p class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">系统管理员</p>
                <p class="text-primary-600 mt-2 text-2xl font-black">{{ adminCount }}</p>
                <p class="text-primary-600 mt-1 text-[11px] font-semibold">具备管理控制台权限</p>
            </div>
            <div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
                <p class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">封禁账号</p>
                <p class="mt-2 text-2xl font-black text-rose-500">{{ bannedCount }}</p>
                <p class="mt-1 text-[11px] font-semibold text-rose-600">已被系统限制访问</p>
            </div>
        </div>

        <!-- 角色筛选与搜索栏 -->
        <div class="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
            <div class="flex flex-wrap gap-1">
                <button
                    v-for="r in ['all', 'admin', 'editor', 'user']"
                    :key="r"
                    type="button"
                    :class="[
                        'rounded-xl px-3 py-1.5 text-xs font-bold transition-all',
                        roleFilter === r ? 'bg-primary-50 text-primary-700 shadow-2xs' : 'text-slate-500 hover:bg-slate-100',
                    ]"
                    @click="roleFilter = r"
                >
                    {{ r === 'all' ? t('common.all') : r.toUpperCase() }}
                </button>
            </div>

            <div class="relative w-full sm:w-72">
                <input
                    v-model="q"
                    :placeholder="t('admin.searchUsers')"
                    class="focus:border-primary-500 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 transition-colors focus:bg-white focus:outline-none"
                />
                <button v-if="q" type="button" class="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600" @click="q = ''">
                    ✕
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
                        <tr v-for="u in filteredUsers" :key="u.id" class="transition-colors hover:bg-slate-50/60">
                            <td class="p-4">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="bg-primary-100 text-primary-800 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
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
                        <tr v-if="!filteredUsers.length && !loading">
                            <td colspan="6" class="p-12 text-center">
                                <!-- 区分「加载失败」与「筛选无结果」 -->
                                <div v-if="loadError" class="flex flex-col items-center">
                                    <span class="mb-1.5 text-3xl">⚠️</span>
                                    <p class="text-sm font-bold text-red-600">{{ loadError }}</p>
                                    <button type="button" class="text-primary-600 mt-2 text-xs font-bold hover:underline" @click="load">
                                        {{ t('common.retry') }}
                                    </button>
                                </div>
                                <div v-else class="flex flex-col items-center">
                                    <span class="mb-1.5 text-3xl">👥</span>
                                    <p class="text-sm font-bold text-slate-700">{{ t('admin.noData') }}</p>
                                    <p class="mt-0.5 text-xs text-slate-400">未找到符合当前搜索或角色过滤条件的用户</p>
                                    <button
                                        v-if="q || roleFilter !== 'all'"
                                        type="button"
                                        class="text-primary-600 mt-2 text-xs font-bold hover:underline"
                                        @click="
                                            q = '';
                                            roleFilter = 'all';
                                        "
                                    >
                                        {{ t('agents.resetFilter') }}
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>
