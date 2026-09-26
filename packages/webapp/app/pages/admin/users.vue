<script setup lang="ts">
import { extractApiError, formatDate } from '@commons/contract';
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

interface AdminUsersStats {
    total: number;
    adminCount: number;
    bannedCount: number;
}

interface AdminUsersResponse {
    users: AdminUser[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    stats: AdminUsersStats;
}

const users = ref<AdminUser[]>([]);
const stats = ref<AdminUsersStats | null>(null);
const pagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
const q = ref('');
const loading = ref(true);
const loadError = ref('');
const roleFilter = ref('all');

/** 防抖定时器：输入关键字时避免每敲一个字就打一次接口，卸载时必须清理 */
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function onKeywordInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        searchTimer = null;
        load(1);
    }, 350);
}

/** 翻页、筛选与搜索防抖共用 load()，旧请求后回会把上一个条件的结果写回来 */
let loadSeq = 0;

async function load(page = pagination.value.page) {
    const seq = ++loadSeq;
    loading.value = true;
    loadError.value = '';
    try {
        const res = await $fetch<AdminUsersResponse>('/api/admin/users', {
            query: {
                page,
                pageSize: pagination.value.pageSize,
                role: roleFilter.value === 'all' ? undefined : roleFilter.value,
                keyword: q.value.trim() || undefined,
            },
        });
        if (seq !== loadSeq) return;
        users.value = res.users;
        stats.value = res.stats;
        pagination.value = { page: res.page, pageSize: res.pageSize, total: res.total, totalPages: res.totalPages };
    } catch (e) {
        if (seq !== loadSeq) return;
        // 失败时清空并给出可见提示，避免列表空态被误读为「搜索无结果」
        users.value = [];
        stats.value = null;
        loadError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        if (seq === loadSeq) loading.value = false;
    }
}

onMounted(load);
onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer);
});

/** 切换筛选条件后回到第一页，否则可能停在超出范围的页码上看到空列表 */
function applyFilter() {
    load(1);
}

function changeRoleFilter(role: string) {
    roleFilter.value = role;
    applyFilter();
}

function clearFilters() {
    q.value = '';
    roleFilter.value = 'all';
    applyFilter();
}

const hasFilters = computed(() => Boolean(q.value.trim() || roleFilter.value !== 'all'));

/** 成功提示(重置密码):就地展示,靠 useFlashSuccess 的定时器自动清除 */
const { success: flashMessage, flashSuccess } = useFlashSuccess();

/** 重置密码抽屉:走 Better Auth 的 /api/auth/admin/set-user-password(服务端 admin 插件内置,无需新接口) */
const resetTarget = ref<AdminUser | null>(null);
const resetForm = ref({ newPassword: '', confirmPassword: '', revokeSessions: true });
const resetting = ref(false);
const resetError = ref('');

function openResetPassword(u: AdminUser) {
    resetTarget.value = u;
    resetForm.value = { newPassword: '', confirmPassword: '', revokeSessions: true };
    resetError.value = '';
}

async function submitResetPassword() {
    const target = resetTarget.value;
    if (!target) return;
    resetError.value = '';
    // 与 Better Auth 默认的 password.minLength(8)保持一致,服务端 assertPasswordNotTooShort 还会再校验
    if (resetForm.value.newPassword.length < 8) {
        resetError.value = t('common.passwordMinLength');
        return;
    }
    if (resetForm.value.newPassword !== resetForm.value.confirmPassword) {
        resetError.value = t('common.passwordMismatch');
        return;
    }
    resetting.value = true;
    try {
        await $fetch('/api/auth/admin/set-user-password', {
            method: 'POST',
            body: { userId: target.id, newPassword: resetForm.value.newPassword },
        });
        // 重置密码的常见目的是让原凭据立即失效:不吊销旧会话的话,已登录设备仍可继续使用
        if (resetForm.value.revokeSessions) {
            await $fetch('/api/auth/admin/revoke-user-sessions', {
                method: 'POST',
                body: { userId: target.id },
            });
        }
        resetTarget.value = null;
        flashSuccess(t('adminForm.passwordResetDone'));
    } catch (e) {
        resetError.value = extractApiError(e, t('adminForm.operationFailed'));
    } finally {
        resetting.value = false;
    }
}

async function action(userId: string, act: string, extra?: Record<string, unknown>) {
    loadError.value = '';
    try {
        await $fetch('/api/admin/users/action', {
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
        await $fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
        await load();
    } catch (e) {
        loadError.value = extractApiError(e, t('adminForm.deleteFailed'));
    }
}
</script>

<template>
    <div class="space-y-6">
        <div v-if="flashMessage" class="app-alert app-alert-success">{{ flashMessage }}</div>
        <div v-if="loadError" class="app-alert app-alert-danger">
            {{ loadError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load()">{{ t('common.retry') }}</button>
        </div>
        <div class="app-page-header !mb-0">
            <div>
                <h1 class="app-page-title text-strong">{{ t('nav.users') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.usersSubtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <button type="button" class="app-btn app-btn-outline app-btn-sm" @click="load()">🔄 {{ t('common.refresh') }}</button>
            </div>
        </div>

        <!-- 用户指标概览：全局聚合由服务端返回，数值统一深灰，仅「封禁」这一异常项用语义色 -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('admin.usersCount') }}</p>
                    <p class="app-stat-value text-strong">{{ stats?.total ?? '-' }}</p>
                    <p class="text-faint mt-1 text-[11px]">{{ t('adminForm.statTotalUsersHint') }}</p>
                </div>
                <span class="app-stat-icon">👥</span>
            </div>
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('adminForm.statAdmins') }}</p>
                    <p class="app-stat-value text-strong">{{ stats?.adminCount ?? '-' }}</p>
                    <p class="text-faint mt-1 text-[11px]">{{ t('adminForm.statAdminsHint') }}</p>
                </div>
                <span class="app-stat-icon">🛡️</span>
            </div>
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('adminForm.statBanned') }}</p>
                    <p class="app-stat-value text-[color:var(--danger)]">{{ stats?.bannedCount ?? '-' }}</p>
                    <p class="text-faint mt-1 text-[11px]">{{ t('adminForm.statBannedHint') }}</p>
                </div>
                <span class="app-stat-icon">⛔</span>
            </div>
        </div>

        <!-- 角色筛选与搜索栏：关键字与角色都由服务端过滤 -->
        <div class="app-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="app-segmented">
                <button
                    v-for="r in ['all', 'admin', 'editor', 'user']"
                    :key="r"
                    type="button"
                    class="app-segmented-item"
                    :aria-pressed="roleFilter === r"
                    @click="changeRoleFilter(r)"
                >
                    {{ r === 'all' ? t('common.all') : r.toUpperCase() }}
                </button>
            </div>

            <div class="relative w-full sm:w-72">
                <input
                    v-model="q"
                    :placeholder="t('admin.searchUsers')"
                    :aria-label="t('admin.searchUsers')"
                    class="app-input !py-2 !pr-8 !text-xs"
                    @input="onKeywordInput"
                />
                <button
                    v-if="q"
                    type="button"
                    class="text-faint absolute top-1/2 right-2.5 -translate-y-1/2 text-xs hover:opacity-70"
                    :aria-label="t('common.clear')"
                    @click="clearFilters"
                >
                    ✕
                </button>
            </div>
        </div>

        <div class="app-table-wrap">
            <table class="app-table">
                <thead>
                    <tr>
                        <th>{{ t('adminForm.colUser') }}</th>
                        <th>{{ t('adminForm.colEmail') }}</th>
                        <th>{{ t('adminForm.colRoles') }}</th>
                        <th>{{ t('common.status') }}</th>
                        <th>{{ t('adminForm.colRegisteredAt') }}</th>
                        <th class="text-right">{{ t('common.actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="u in users" :key="u.id">
                        <td>
                            <div class="flex items-center gap-3">
                                <div class="app-avatar h-8 w-8 shrink-0 !rounded-full text-xs">{{ u.name?.[0]?.toUpperCase() || 'U' }}</div>
                                <span class="text-strong font-bold">{{ u.name }}</span>
                            </div>
                        </td>
                        <td class="text-soft font-medium">{{ u.email }}</td>
                        <td>
                            <select
                                :value="u.role"
                                :aria-label="t('adminForm.colRoles') + ' · ' + (u.name || u.email)"
                                class="app-input !w-auto !px-2 !py-1 !text-xs"
                                @change="setRole(u.id, $event)"
                            >
                                <option value="user">{{ t('adminForm.roleUser') }}</option>
                                <option value="editor">{{ t('adminForm.roleEditor') }}</option>
                                <option value="admin">{{ t('adminForm.roleAdmin') }}</option>
                            </select>
                        </td>
                        <td>
                            <span :class="u.banned ? 'app-badge-danger' : 'app-badge-success'" class="app-badge">
                                {{ u.banned ? t('adminForm.userBanned') : t('adminForm.userActive') }}
                            </span>
                        </td>
                        <td class="text-faint">{{ formatDate(u.createdAt) }}</td>
                        <td>
                            <div class="app-table-actions">
                                <button class="app-btn app-btn-outline app-btn-sm" @click="openResetPassword(u)">
                                    {{ t('adminForm.resetPassword') }}
                                </button>
                                <button v-if="!u.banned" class="app-btn app-btn-danger app-btn-sm" @click="action(u.id, 'ban')">
                                    {{ t('adminForm.ban') }}
                                </button>
                                <button v-else class="app-btn app-btn-outline app-btn-sm" @click="action(u.id, 'unban')">{{ t('adminForm.unban') }}</button>
                                <button class="app-btn app-btn-ghost app-btn-sm" @click="removeUser(u.id)">{{ t('common.delete') }}</button>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="!users.length && !loading">
                        <td colspan="6" class="!whitespace-normal">
                            <!-- 区分「加载失败」与「筛选无结果」 -->
                            <div v-if="loadError" class="app-empty">
                                <span class="app-empty-icon">⚠️</span>
                                <p class="app-empty-title !text-[color:var(--danger)]">{{ loadError }}</p>
                                <button type="button" class="app-link mt-2 text-xs" @click="load()">{{ t('common.retry') }}</button>
                            </div>
                            <div v-else class="app-empty">
                                <span class="app-empty-icon">👥</span>
                                <p class="app-empty-title">{{ t('admin.noData') }}</p>
                                <p class="app-empty-desc">{{ t('adminForm.usersEmptyFiltered') }}</p>
                                <button v-if="hasFilters" type="button" class="app-link mt-2 text-xs" @click="clearFilters">
                                    {{ t('agents.resetFilter') }}
                                </button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
            <div v-if="loading" class="space-y-2 p-4">
                <div v-for="i in 3" :key="i" class="app-skeleton h-10 !rounded-xl" />
            </div>
        </div>

        <!-- 重置密码抽屉：管理端统一右侧滑出，标题带目标用户（抽屉未打开时 resetTarget 为 null，绑定走可选链） -->
        <AdminDrawer
            :open="resetTarget !== null"
            :title="t('adminForm.resetPasswordFor', { name: resetTarget?.name || resetTarget?.email || '' })"
            @close="resetTarget = null"
        >
            <form class="space-y-3" @submit.prevent="submitResetPassword">
                <div class="app-panel p-3 text-xs">
                    <p class="text-strong font-bold">{{ resetTarget?.name }}</p>
                    <p class="text-faint mt-0.5">{{ resetTarget?.email }}</p>
                </div>
                <div>
                    <label class="app-label" for="admin-reset-password">{{ t('adminForm.resetNewPassword') }}</label>
                    <input
                        id="admin-reset-password"
                        v-model="resetForm.newPassword"
                        type="password"
                        required
                        minlength="8"
                        autocomplete="new-password"
                        class="app-input"
                    />
                </div>
                <div>
                    <label class="app-label" for="admin-reset-confirm">{{ t('adminForm.resetConfirmPassword') }}</label>
                    <input
                        id="admin-reset-confirm"
                        v-model="resetForm.confirmPassword"
                        type="password"
                        required
                        minlength="8"
                        autocomplete="new-password"
                        class="app-input"
                    />
                </div>
                <label class="flex items-start gap-2 text-xs">
                    <input v-model="resetForm.revokeSessions" type="checkbox" class="app-checkbox mt-0.5" />
                    <span class="text-soft">{{ t('adminForm.revokeUserSessions') }}</span>
                </label>

                <p v-if="resetError" class="app-help app-help-error">{{ resetError }}</p>

                <div class="flex justify-end gap-2 pt-1">
                    <button type="button" class="app-btn app-btn-ghost" @click="resetTarget = null">{{ t('common.cancel') }}</button>
                    <button type="submit" class="app-btn app-btn-primary" :disabled="resetting">
                        {{ resetting ? t('common.loading') : t('common.save') }}
                    </button>
                </div>
            </form>
        </AdminDrawer>

        <!-- 分页：总数与列表都由服务端返回，用户量增长后不再只看到最早的一页 -->
        <div v-if="!loading && pagination.totalPages > 1" class="flex items-center justify-between">
            <p class="text-faint text-xs">{{ t('admin.pageOf', { page: pagination.page, total: pagination.totalPages }) }}</p>
            <div class="flex items-center gap-2">
                <button type="button" class="app-btn app-btn-outline app-btn-sm" :disabled="pagination.page <= 1" @click="load(pagination.page - 1)">
                    {{ t('admin.prevPage') }}
                </button>
                <button
                    type="button"
                    class="app-btn app-btn-outline app-btn-sm"
                    :disabled="pagination.page >= pagination.totalPages"
                    @click="load(pagination.page + 1)"
                >
                    {{ t('admin.nextPage') }}
                </button>
            </div>
        </div>
    </div>
</template>
