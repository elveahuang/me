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
const loading = ref(true); // 首帧即加载态：数据要等挂载后的请求，初值 false 会让「暂无…」空态先闪一帧，SSR 首屏更是直接把空态发给用户
const error = ref('');
/** 抽屉内表单（发送/用户搜索）的错误独立于列表级 error：两者共用一个变量的话，
 *  列表刷新失败会在抽屉里重复出现，抽屉里的校验失败也会被页级横幅抢走。 */
const formError = ref('');
const { success, flashSuccess } = useFlashSuccess(2500);
const sending = ref(false);
const filterAudience = ref('all');
const sendOpen = ref(false);

function openSend() {
    // 只清表单自己的错误：顺手清掉 error 会把列表加载失败的提示藏起来
    formError.value = '';
    sendOpen.value = true;
}

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

/** 翻页与受众筛选共用 load()，旧请求后回会把上一个筛选的结果写回来 */
let loadSeq = 0;

async function load() {
    const seq = ++loadSeq;
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
        if (seq !== loadSeq) return;
        items.value = res.items;
        total.value = res.total;
    } catch (e) {
        if (seq !== loadSeq) return;
        // 失败时清空列表：保留上次结果会让「接口挂了」看起来像筛选后只剩这些
        items.value = [];
        total.value = 0;
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        if (seq === loadSeq) loading.value = false;
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

/** 用户搜索防抖定时器：卸载时清理（成功提示的自动清除由 useFlashSuccess 自管） */
onBeforeUnmount(() => {
    if (userTimer) clearTimeout(userTimer);
});

/** 与列表 loadSeq 同理：输入防抖、removeUser、切换受众三处都会触发搜索，后发先至的响应不能覆盖新关键词的结果 */
let userSearchSeq = 0;

async function searchUsers() {
    const seq = ++userSearchSeq;
    searchingUsers.value = true;
    try {
        const res = await $fetch<{ users: TargetUser[] }>('/api/admin/target-users', {
            query: { keyword: userKeyword.value || undefined, limit: 20 },
        });
        if (seq !== userSearchSeq) return;
        // 已选中的用户不重复出现在候选列表
        userOptions.value = res.users.filter((u) => !selectedUsers.value.some((s) => s.id === u.id));
    } catch (e) {
        if (seq !== userSearchSeq) return;
        formError.value = extractApiError(e, t('common.error'));
    } finally {
        if (seq === userSearchSeq) searchingUsers.value = false;
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
    if (sending.value) return;
    formError.value = '';
    success.value = '';
    if (!form.title.trim()) {
        formError.value = t('notifications.titleRequired');
        return;
    }
    if (form.audience === 'users' && !selectedUsers.value.length) {
        formError.value = t('notifications.noTargetSelected');
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
        flashSuccess(t('notifications.sent'));
        Object.assign(form, { title: '', content: '', linkUrl: '', audience: 'all' as const, type: 'system', level: 'info' });
        selectedUsers.value = [];
        sendOpen.value = false;
        await load();
    } catch (e) {
        formError.value = extractApiError(e, t('common.error'));
    } finally {
        sending.value = false;
    }
}

async function remove(row: AdminNotificationRow) {
    if (!confirm(t('notifications.deleteConfirm', { title: row.title }))) return;
    try {
        await $fetch(`/api/admin/notifications/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        flashSuccess(t('common.deleted'));
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
        <div class="app-page-header !mb-0">
            <div>
                <h1 class="app-page-title text-strong">{{ t('nav.notifications') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.adminNotifSubtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <button class="app-btn app-btn-primary" @click="openSend">{{ t('notifications.send') }}</button>
            </div>
        </div>

        <!-- 用主题令牌而不是 bg-red-50 / bg-emerald-50：浅色专用色块在深色模式下几乎读不出来 -->
        <div v-if="error" class="app-alert app-alert-danger">
            {{ error }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div v-if="success" class="app-alert app-alert-success">{{ success }}</div>

        <!-- 推送表单（右侧抽屉） -->
        <AdminDrawer :open="sendOpen" :title="t('notifications.send')" width-class="sm:max-w-2xl" @close="sendOpen = false">
            <div class="space-y-3">
                <p v-if="formError" class="app-alert app-alert-danger">{{ formError }}</p>
                <div class="grid gap-3 sm:grid-cols-2">
                    <input
                        :aria-label="t('notifications.pushTitle')"
                        v-model="form.title"
                        :placeholder="t('notifications.pushTitle')"
                        class="app-input sm:col-span-2"
                    />
                    <textarea
                        :aria-label="t('notifications.pushContent')"
                        v-model="form.content"
                        rows="3"
                        :placeholder="t('notifications.pushContent')"
                        class="app-input sm:col-span-2"
                    />
                    <select v-model="form.type" :aria-label="t('notifications.typeLabel')" class="app-input">
                        <option v-for="tp in NOTIFICATION_TYPES" :key="tp.value" :value="tp.value">{{ tp.label }}</option>
                    </select>
                    <select v-model="form.level" :aria-label="t('adminForm.selectLevel')" class="app-input">
                        <option value="info">{{ t('adminForm.levelInfo') }}</option>
                        <option value="success">{{ t('adminForm.levelSuccess') }}</option>
                        <option value="warning">{{ t('adminForm.levelWarning') }}</option>
                        <option value="danger">{{ t('adminForm.levelDanger') }}</option>
                    </select>
                    <input
                        :aria-label="t('notifications.linkPlaceholder')"
                        v-model="form.linkUrl"
                        :placeholder="t('notifications.linkPlaceholder')"
                        class="app-input sm:col-span-2"
                    />
                </div>

                <!-- 受众选择 -->
                <div class="app-panel p-3">
                    <div class="flex items-center gap-3">
                        <label class="text-soft flex items-center gap-2 text-sm">
                            <input v-model="form.audience" type="radio" value="all" class="app-checkbox" />
                            <span>{{ t('notifications.sendToAll') }}</span>
                        </label>
                        <label class="text-soft flex items-center gap-2 text-sm">
                            <input v-model="form.audience" type="radio" value="users" class="app-checkbox" />
                            <span>{{ t('notifications.sendToUsers') }}</span>
                        </label>
                    </div>

                    <div v-if="form.audience === 'users'" class="mt-3 space-y-2">
                        <input
                            v-model="userKeyword"
                            :placeholder="t('notifications.selectUsers')"
                            :aria-label="t('notifications.selectUsers')"
                            class="app-input"
                        />

                        <div v-if="selectedUsers.length" class="flex flex-wrap gap-2">
                            <span v-for="user in selectedUsers" :key="user.id" class="app-chip app-chip-brand">
                                <span>{{ user.name }}（{{ user.email }}）</span>
                                <button type="button" class="text-hover-strong" :aria-label="t('common.delete')" @click="removeUser(user.id)">✕</button>
                            </span>
                        </div>

                        <div class="border-line bg-surface max-h-52 overflow-y-auto rounded-lg border">
                            <button
                                v-for="user in userOptions"
                                :key="user.id"
                                type="button"
                                class="border-line flex w-full items-center justify-between border-b px-3 py-2 text-left text-xs hover:bg-[color:var(--surface-3)]"
                                @click="addUser(user)"
                            >
                                <span>
                                    <b class="text-strong">{{ user.name }}</b>
                                    <span class="text-faint ml-2">{{ user.email }}</span>
                                </span>
                                <span class="text-faint text-[10px]">{{ user.role }}</span>
                            </button>
                            <p v-if="!userOptions.length" class="text-faint px-3 py-4 text-center text-xs">
                                {{ searchingUsers ? t('common.loading') : t('admin.noData') }}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            <template #footer>
                <button class="app-btn app-btn-ghost" @click="sendOpen = false">{{ t('common.cancel') }}</button>
                <button class="app-btn app-btn-primary" :disabled="sending" @click="send">
                    {{ sending ? t('common.loading') : t('notifications.send') }}
                </button>
            </template>
        </AdminDrawer>

        <!-- 历史记录 -->
        <div class="app-card p-6">
            <div class="mb-4 flex flex-wrap items-center gap-3">
                <h2 class="text-strong text-sm font-bold">{{ t('adminForm.pushHistory') }}</h2>
                <select v-model="filterAudience" :aria-label="t('adminForm.selectAudience')" class="app-input !w-auto !py-1.5 !text-xs">
                    <option value="all">{{ t('common.all') }}</option>
                    <option value="broadcast">{{ t('notifications.sendToAll') }}</option>
                    <option value="targeted">{{ t('notifications.sendToUsers') }}</option>
                </select>
                <span class="text-faint text-xs">{{ t('common.total') }} {{ total }}</span>
            </div>

            <div v-if="loading" class="space-y-2">
                <div v-for="i in 3" :key="i" class="app-skeleton h-14 !rounded-xl" />
            </div>

            <div v-else class="overflow-x-auto">
                <table class="app-table">
                    <thead>
                        <tr>
                            <th>{{ t('adminForm.colMessage') }}</th>
                            <th>{{ t('notifications.typeLabel') }}</th>
                            <th>{{ t('notifications.targetUsers') }}</th>
                            <th>{{ t('adminForm.colRead') }}</th>
                            <th>{{ t('adminForm.colTime') }}</th>
                            <th class="text-right">{{ t('common.actions') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in items" :key="row.id">
                            <td class="app-table-cell-wrap">
                                <p class="text-strong font-medium">{{ row.title }}</p>
                                <p class="text-faint text-[11px]">{{ row.content }}</p>
                            </td>
                            <td>
                                <span class="app-chip">{{ typeLabel(row.type) }}</span>
                            </td>
                            <td class="text-muted-2 text-xs">
                                {{ row.audience === 'all' ? t('notifications.sendToAll') : `${row.targetCount} ${t('notifications.peopleUnit')}` }}
                            </td>
                            <td>
                                <div class="flex items-center gap-2">
                                    <div class="h-1.5 w-16 overflow-hidden rounded-full bg-[color:var(--surface-3)]">
                                        <div class="bg-brand h-full rounded-full" :style="{ width: `${readPercent(row)}%` }" />
                                    </div>
                                    <span class="text-muted-2 text-xs">{{ readRate(row) }}</span>
                                    <span class="text-faint text-[10px] tabular-nums">{{ readPercent(row) }}%</span>
                                </div>
                            </td>
                            <td class="text-faint text-xs">{{ formatDate(row.createdAt) }}</td>
                            <td>
                                <div class="app-table-actions">
                                    <button class="app-btn app-btn-danger app-btn-sm" @click="remove(row)">{{ t('common.delete') }}</button>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="!items.length">
                            <td colspan="6" class="!whitespace-normal">
                                <div class="app-empty">
                                    <span class="app-empty-icon">📣</span>
                                    <p class="app-empty-title">{{ t('admin.tableEmpty') }}</p>
                                    <p class="app-empty-desc">{{ t('notifications.send') }}</p>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="totalPages > 1" class="mt-4 flex items-center justify-end gap-2 text-xs">
                <button class="app-btn app-btn-outline app-btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">{{ t('admin.prevPage') }}</button>
                <span class="text-muted-2 tabular-nums">{{ page }} / {{ totalPages }}</span>
                <button class="app-btn app-btn-outline app-btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">{{ t('admin.nextPage') }}</button>
            </div>
        </div>
    </div>
</template>
