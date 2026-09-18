<script setup lang="ts">
import { extractApiError, formatDate, NOTIFICATION_TYPES, type NotificationRecord } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

interface AdminNotificationRow extends Omit<NotificationRecord, 'read' | 'readAt'> {
    readCount: number;
    /** 广播为当前用户总数，定向为实际收件人数 */
    targetCount: number;
    /** 分母口径：all-users=全员广播，selected=定向推送 */
    audienceBase?: 'all-users' | 'selected';
}

interface TargetUser {
    id: string;
    name: string;
    email: string;
    role: string;
}

const { t } = useI18n();

const items = ref<AdminNotificationRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const error = ref('');
const success = ref('');
const sending = ref(false);
const filterAudience = ref('all');

const form = reactive({
    title: '',
    content: '',
    type: 'system',
    level: 'info',
    audience: 'all' as 'all' | 'users',
    linkUrl: '',
});

// 定向推送：用户搜索与多选
const userKeyword = ref('');
const userOptions = ref<TargetUser[]>([]);
const selectedUsers = ref<TargetUser[]>([]);
const searchingUsers = ref(false);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load() {
    loading.value = true;
    error.value = '';
    try {
        const res = await $fetch<{ items: AdminNotificationRow[]; total: number }>('/api/admin/notifications', {
            query: {
                page: page.value,
                pageSize,
                // 'broadcast'/'targeted' 是页面筛选值，需映射为服务端 audience 字段
                audience: filterAudience.value === 'broadcast' ? 'all' : filterAudience.value === 'targeted' ? 'users' : undefined,
            },
        });
        items.value = res.items;
        total.value = res.total;
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

watch(filterAudience, () => {
    page.value = 1;
    void load();
});

let userTimer: ReturnType<typeof setTimeout> | null = null;
watch(userKeyword, () => {
    if (userTimer) clearTimeout(userTimer);
    userTimer = setTimeout(() => void searchUsers(), 300);
});

/** 用户搜索防抖与成功提示定时器：卸载时一并清理 */
onBeforeUnmount(() => {
    if (userTimer) clearTimeout(userTimer);
    if (successTimer) clearTimeout(successTimer);
});

let successTimer: ReturnType<typeof setTimeout> | null = null;
function flashSuccess(text: string, ms = 2500) {
    success.value = text;
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => (success.value = ''), ms);
}

async function searchUsers() {
    searchingUsers.value = true;
    try {
        const res = await $fetch<{ users: TargetUser[] }>('/api/admin/target-users', {
            query: { keyword: userKeyword.value || undefined, limit: 20 },
        });
        // 已选中的用户不重复出现在候选列表
        userOptions.value = res.users.filter((u) => !selectedUsers.value.some((s) => s.id === u.id));
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        searchingUsers.value = false;
    }
}

watch(
    () => form.audience,
    (next) => {
        if (next === 'users') void searchUsers();
    },
);

function addUser(user: TargetUser) {
    if (!selectedUsers.value.some((s) => s.id === user.id)) {
        selectedUsers.value.push(user);
    }
    userOptions.value = userOptions.value.filter((u) => u.id !== user.id);
}

function removeUser(id: string) {
    selectedUsers.value = selectedUsers.value.filter((u) => u.id !== id);
    void searchUsers();
}

async function send() {
    error.value = '';
    success.value = '';
    if (!form.title.trim()) {
        error.value = '标题必填';
        return;
    }
    if (form.audience === 'users' && !selectedUsers.value.length) {
        error.value = t('notifications.noTargetSelected');
        return;
    }
    if (!confirm(t('notifications.sendConfirm'))) return;

    sending.value = true;
    try {
        await $fetch('/api/admin/notifications', {
            method: 'POST',
            body: {
                title: form.title,
                content: form.content,
                type: form.type,
                level: form.level,
                audience: form.audience,
                linkUrl: form.linkUrl,
                targetUsers: selectedUsers.value.map((u) => u.id),
            },
        });
        success.value = t('notifications.sent');
        Object.assign(form, { title: '', content: '', linkUrl: '', audience: 'all' as const, type: 'system', level: 'info' });
        selectedUsers.value = [];
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        sending.value = false;
    }
}

async function remove(row: AdminNotificationRow) {
    if (!confirm(`确定删除「${row.title}」？`)) return;
    try {
        await $fetch(`/api/admin/notifications/${row.id}`, { method: 'DELETE' });
        success.value = t('common.deleted');
        await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

function goPage(next: number) {
    if (next < 1 || next > totalPages.value) return;
    page.value = next;
    void load();
}

function typeLabel(value: string) {
    return NOTIFICATION_TYPES.find((item) => item.value === value)?.label ?? value;
}

/**
 * 已读展示：
 * - 定向推送：已读数 / 收件人数
 * - 全员广播：已读数 / 总用户数（分母由服务端返回，会随新增用户增长）
 */
function readRate(row: AdminNotificationRow): string {
    if (!row.targetCount) return `${row.readCount} ${t('notifications.readUnit')}`;
    return `${row.readCount} / ${row.targetCount}`;
}

/** 已读百分比，用于进度条；分母为 0 时返回 0 */
function readPercent(row: AdminNotificationRow): number {
    if (!row.targetCount) return 0;
    return Math.min(100, Math.round((row.readCount / row.targetCount) * 100));
}
</script>

<template>
    <div class="space-y-6">
        <div>
            <h1 class="text-2xl font-bold text-gray-800">{{ t('nav.notifications') }}</h1>
            <p class="mt-1 text-xs text-gray-400">向全体用户或指定用户推送系统消息、平台公告、活动与账单提醒</p>
        </div>

        <div v-if="error" class="rounded-xl bg-red-50 p-3 text-sm text-red-600">{{ error }}</div>
        <div v-if="success" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{{ success }}</div>

        <!-- 推送表单 -->
        <div class="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
            <h2 class="text-sm font-bold text-gray-700">{{ t('notifications.send') }}</h2>
            <div class="grid gap-3 sm:grid-cols-2">
                <input
                    v-model="form.title"
                    :placeholder="t('notifications.pushTitle')"
                    class="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
                />
                <textarea
                    v-model="form.content"
                    rows="3"
                    :placeholder="t('notifications.pushContent')"
                    class="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
                />
                <select v-model="form.type" class="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option v-for="tp in NOTIFICATION_TYPES" :key="tp.value" :value="tp.value">{{ tp.label }}</option>
                </select>
                <select v-model="form.level" class="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option value="info">信息</option>
                    <option value="success">推荐</option>
                    <option value="warning">提醒</option>
                    <option value="danger">重要</option>
                </select>
                <input
                    v-model="form.linkUrl"
                    placeholder="跳转链接（可选），如 /pricing"
                    class="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
                />
            </div>

            <!-- 受众选择 -->
            <div class="rounded-xl bg-gray-50 p-3">
                <div class="flex items-center gap-3">
                    <label class="flex items-center gap-2 text-sm text-gray-700">
                        <input v-model="form.audience" type="radio" value="all" />
                        <span>{{ t('notifications.sendToAll') }}</span>
                    </label>
                    <label class="flex items-center gap-2 text-sm text-gray-700">
                        <input v-model="form.audience" type="radio" value="users" />
                        <span>{{ t('notifications.sendToUsers') }}</span>
                    </label>
                </div>

                <div v-if="form.audience === 'users'" class="mt-3 space-y-2">
                    <input
                        v-model="userKeyword"
                        :placeholder="t('notifications.selectUsers')"
                        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />

                    <div v-if="selectedUsers.length" class="flex flex-wrap gap-2">
                        <span
                            v-for="user in selectedUsers"
                            :key="user.id"
                            class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700"
                        >
                            <span>{{ user.name }}（{{ user.email }}）</span>
                            <button type="button" class="text-emerald-500 hover:text-emerald-800" @click="removeUser(user.id)">✕</button>
                        </span>
                    </div>

                    <div class="max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                        <button
                            v-for="user in userOptions"
                            :key="user.id"
                            type="button"
                            class="flex w-full items-center justify-between border-b border-gray-50 px-3 py-2 text-left text-xs hover:bg-gray-50"
                            @click="addUser(user)"
                        >
                            <span>
                                <b class="text-gray-700">{{ user.name }}</b>
                                <span class="ml-2 text-gray-400">{{ user.email }}</span>
                            </span>
                            <span class="text-[10px] text-gray-400">{{ user.role }}</span>
                        </button>
                        <p v-if="!userOptions.length" class="px-3 py-4 text-center text-xs text-gray-400">
                            {{ searchingUsers ? t('common.loading') : t('admin.noData') }}
                        </p>
                    </div>
                </div>
            </div>

            <button class="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50" :disabled="sending" @click="send">
                {{ sending ? t('common.loading') : t('notifications.send') }}
            </button>
        </div>

        <!-- 历史记录 -->
        <div class="rounded-2xl bg-white p-6 shadow-sm">
            <div class="mb-4 flex flex-wrap items-center gap-3">
                <h2 class="text-sm font-bold text-gray-700">推送记录</h2>
                <select v-model="filterAudience" class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs">
                    <option value="all">{{ t('common.all') }}</option>
                    <option value="broadcast">{{ t('notifications.sendToAll') }}</option>
                    <option value="targeted">{{ t('notifications.sendToUsers') }}</option>
                </select>
                <span class="text-xs text-gray-400">{{ t('common.total') }} {{ total }}</span>
            </div>

            <div v-if="loading" class="space-y-2">
                <div v-for="i in 3" :key="i" class="h-14 animate-pulse rounded-xl bg-gray-50" />
            </div>

            <div v-else class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="text-left text-xs text-gray-400">
                        <tr>
                            <th class="py-2 pr-4">消息</th>
                            <th class="py-2 pr-4">{{ t('notifications.typeLabel') }}</th>
                            <th class="py-2 pr-4">{{ t('notifications.targetUsers') }}</th>
                            <th class="py-2 pr-4">已读</th>
                            <th class="py-2 pr-4">时间</th>
                            <th class="py-2">{{ t('common.actions') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in items" :key="row.id" class="border-t border-gray-100">
                            <td class="py-3 pr-4">
                                <p class="max-w-[20rem] truncate font-medium text-gray-800">{{ row.title }}</p>
                                <p class="max-w-[20rem] truncate text-[11px] text-gray-400">{{ row.content }}</p>
                            </td>
                            <td class="py-3 pr-4">
                                <span class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">{{ typeLabel(row.type) }}</span>
                            </td>
                            <td class="py-3 pr-4 text-xs text-gray-500">
                                {{ row.audience === 'all' ? t('notifications.sendToAll') : `${row.targetCount} ${t('notifications.peopleUnit')}` }}
                            </td>
                            <td class="py-3 pr-4">
                                <div class="flex items-center gap-2">
                                    <div class="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                                        <div class="h-full rounded-full bg-emerald-500" :style="{ width: `${readPercent(row)}%` }" />
                                    </div>
                                    <span class="text-xs text-gray-500">{{ readRate(row) }}</span>
                                    <span class="text-[10px] text-gray-400">{{ readPercent(row) }}%</span>
                                </div>
                            </td>
                            <td class="py-3 pr-4 text-xs text-gray-400">{{ formatDate(row.createdAt) }}</td>
                            <td class="py-3 text-xs">
                                <button class="text-red-500 hover:underline" @click="remove(row)">{{ t('common.delete') }}</button>
                            </td>
                        </tr>
                        <tr v-if="!items.length">
                            <td colspan="6" class="py-8 text-center text-xs text-gray-400">{{ t('admin.tableEmpty') }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="totalPages > 1" class="mt-4 flex items-center justify-end gap-2 text-xs">
                <button class="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
                <span>{{ page }} / {{ totalPages }}</span>
                <button class="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" :disabled="page >= totalPages" @click="goPage(page + 1)">
                    下一页
                </button>
            </div>
        </div>
    </div>
</template>
