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
    loadError.value = '';
    try {
        await ($fetch as any)('/api/admin/users/action', {
            method: 'POST',
            body: { userId, action: act, ...extra },
        });
        await load();
    } catch (e) {
        // 失败必须重新拉取：否则下拉框停留在新选的角色上，看起来像改成功了
        loadError.value = extractApiError(e, t('adminForm.operationFailed'));
        await load();
    }
}

async function setRole(userId: string, event: Event) {
    const role = (event.target as HTMLSelectElement).value as 'admin' | 'editor' | 'user';
    await action(userId, 'set-role', { role });
}

async function removeUser(userId: string) {
    if (!confirm(t('adminForm.deleteConfirm'))) return;
    loadError.value = '';
    try {
        await $fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        await load();
    } catch (e) {
        loadError.value = extractApiError(e, t('adminForm.deleteFailed'));
    }
}
</script>

<template>
    <div class="space-y-6">
        <div v-if="loadError" class="app-alert app-alert-danger">
            {{ loadError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div class="app-page-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <h1 class="app-page-title text-strong">{{ t('nav.users') }}</h1>
                <p class="app-page-subtitle">管理用户凭据、身份角色授权与账号安全治理</p>
            </div>
            <div class="app-page-actions !mb-0">
                <button type="button" class="app-btn app-btn-outline app-btn-sm" @click="load">🔄 {{ t('common.refresh') }}</button>
            </div>
        </div>

        <!-- 用户指标概览：数值统一深灰，仅「封禁」这一异常项用语义色 -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('admin.usersCount') }}</p>
                    <p class="app-stat-value text-strong">{{ users.length }}</p>
                    <p class="text-faint mt-1 text-[11px]">已注册账号总量</p>
                </div>
                <span class="app-stat-icon">👥</span>
            </div>
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">系统管理员</p>
                    <p class="app-stat-value text-strong">{{ adminCount }}</p>
                    <p class="text-faint mt-1 text-[11px]">具备管理控制台权限</p>
                </div>
                <span class="app-stat-icon">🛡️</span>
            </div>
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">封禁账号</p>
                    <p class="app-stat-value text-[color:var(--danger)]">{{ bannedCount }}</p>
                    <p class="text-faint mt-1 text-[11px]">已被系统限制访问</p>
                </div>
                <span class="app-stat-icon">⛔</span>
            </div>
        </div>

        <!-- 角色筛选与搜索栏 -->
        <div class="app-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="app-segmented">
                <button
                    v-for="r in ['all', 'admin', 'editor', 'user']"
                    :key="r"
                    type="button"
                    class="app-segmented-item"
                    :aria-pressed="roleFilter === r"
                    @click="roleFilter = r"
                >
                    {{ r === 'all' ? t('common.all') : r.toUpperCase() }}
                </button>
            </div>

            <div class="relative w-full sm:w-72">
                <input v-model="q" :placeholder="t('admin.searchUsers')" class="app-input !py-2 pr-8 !text-xs" />
                <button v-if="q" type="button" class="text-faint absolute top-1/2 right-2.5 -translate-y-1/2 text-xs hover:opacity-70" @click="q = ''">
                    ✕
                </button>
            </div>
        </div>

        <div class="app-table-wrap">
            <table class="app-table">
                <thead>
                    <tr>
                        <th>用户</th>
                        <th>邮箱</th>
                        <th>角色权限</th>
                        <th>状态</th>
                        <th>注册时间</th>
                        <th class="text-right">{{ t('common.actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="u in filteredUsers" :key="u.id">
                        <td>
                            <div class="flex items-center gap-3">
                                <div class="app-avatar h-8 w-8 shrink-0 rounded-full text-xs">{{ u.name?.[0]?.toUpperCase() || 'U' }}</div>
                                <span class="text-strong font-bold">{{ u.name }}</span>
                            </div>
                        </td>
                        <td class="text-soft font-medium">{{ u.email }}</td>
                        <td>
                            <select :value="u.role" class="app-input !w-auto !px-2 !py-1 !text-xs" @change="setRole(u.id, $event)">
                                <option value="user">User（普通）</option>
                                <option value="editor">Editor（运营）</option>
                                <option value="admin">Admin（管理）</option>
                            </select>
                        </td>
                        <td>
                            <span :class="u.banned ? 'app-badge-danger' : 'app-badge-success'" class="app-badge">
                                {{ u.banned ? '已封禁' : '正常' }}
                            </span>
                        </td>
                        <td class="text-faint">{{ new Date(u.createdAt).toLocaleDateString() }}</td>
                        <td>
                            <div class="app-table-actions">
                                <button v-if="!u.banned" class="app-btn app-btn-danger app-btn-sm" @click="action(u.id, 'ban')">封禁</button>
                                <button v-else class="app-btn app-btn-outline app-btn-sm" @click="action(u.id, 'unban')">解封</button>
                                <button class="app-btn app-btn-ghost app-btn-sm" @click="removeUser(u.id)">{{ t('common.delete') }}</button>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="!filteredUsers.length && !loading">
                        <td colspan="6" class="!whitespace-normal">
                            <!-- 区分「加载失败」与「筛选无结果」 -->
                            <div v-if="loadError" class="app-empty">
                                <span class="app-empty-icon">⚠️</span>
                                <p class="app-empty-title !text-[color:var(--danger)]">{{ loadError }}</p>
                                <button type="button" class="app-link mt-2 text-xs" @click="load">{{ t('common.retry') }}</button>
                            </div>
                            <div v-else class="app-empty">
                                <span class="app-empty-icon">👥</span>
                                <p class="app-empty-title">{{ t('admin.noData') }}</p>
                                <p class="app-empty-desc">未找到符合当前搜索或角色过滤条件的用户</p>
                                <button
                                    v-if="q || roleFilter !== 'all'"
                                    type="button"
                                    class="app-link mt-2 text-xs"
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
            <div v-if="loading" class="space-y-2 p-4">
                <div v-for="i in 3" :key="i" class="app-skeleton h-10 rounded-xl" />
            </div>
        </div>
    </div>
</template>
