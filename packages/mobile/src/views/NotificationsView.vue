<script setup lang="ts">
import { formatRelativeTime, NOTIFICATION_TYPES, type NotificationRecord, type NotificationsResponse } from '@commons/contract';
import { IonActionSheet, IonContent, IonHeader, IonRefresher, IonRefresherContent, IonTitle, IonToolbar } from '@ionic/vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, extractApiError } from '../api/auth';
import { useUnread } from '../composables/useUnread';
import PageShell from './PageShell.vue';

const { t } = useI18n();

const items = ref<NotificationRecord[]>([]);
const total = ref(0);
// 本页未读数：列表接口的返回值作为权威值，同时同步到共享状态供其他页面角标使用
const unread = ref(0);
const { setUnread } = useUnread();
const page = ref(1);
const pageSize = 15;
const loading = ref(false);
const error = ref('');
const success = ref('');
const filterUnread = ref(false);
const type = ref('all');
const showTypeSheet = ref(false);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const typeLabel = computed(() =>
    type.value === 'all' ? t('common.all') : (NOTIFICATION_TYPES.find((item) => item.value === type.value)?.label ?? type.value),
);

const typeActions = [
    { text: t('common.all'), handler: () => (type.value = 'all') },
    ...NOTIFICATION_TYPES.map((item) => ({ text: item.label, handler: () => (type.value = item.value) })),
    { text: t('common.cancel'), role: 'cancel' },
];

const levelBorder: Record<string, string> = {
    info: '',
    success: 'border-l-2 border-l-emerald-400',
    warning: 'border-l-2 border-l-amber-400',
    danger: 'border-l-2 border-l-red-400',
};

async function load(reset = false) {
    if (reset) page.value = 1;
    loading.value = true;
    error.value = '';
    try {
        const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
        if (filterUnread.value) query.set('unread', '1');
        if (type.value !== 'all') query.set('type', type.value);
        const res = await api<NotificationsResponse>(`/api/notifications?${query.toString()}`);
        items.value = res.items;
        total.value = res.total;
        unread.value = res.unread;
        setUnread(res.unread);
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        loading.value = false;
    }
}

async function handleRefresh(event: CustomEvent) {
    await load(true);
    (event.target as HTMLIonRefresherElement).complete();
}

onMounted(() => load(true));

/** 成功提示自动消失；卸载时清理，避免定时器在页面销毁后写状态 */
let successTimer: ReturnType<typeof setTimeout> | null = null;
function flashSuccess(text: string, ms = 2500) {
    success.value = text;
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => (success.value = ''), ms);
}
onUnmounted(() => {
    if (successTimer) clearTimeout(successTimer);
});

watch([filterUnread, type], () => void load(true));

async function markRead(item: NotificationRecord) {
    if (item.read) return;
    try {
        const res = await api<{ unread: number }>('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids: [item.id] }) });
        item.read = true;
        item.readAt = new Date().toISOString();
        unread.value = res.unread;
        setUnread(res.unread);
    } catch {
        // 标记已读失败不打断浏览
    }
}

async function markAllRead() {
    if (!unread.value) return;
    try {
        const res = await api<{ unread: number }>('/api/notifications/read', { method: 'POST', body: JSON.stringify({}) });
        items.value = items.value.map((item) => ({ ...item, read: true, readAt: item.readAt ?? new Date().toISOString() }));
        unread.value = res.unread;
        setUnread(res.unread);
        flashSuccess(t('notifications.allRead'));
        if (filterUnread.value) await load(true);
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

const iconFor = (value: string) => (value === 'billing' ? '💳' : value === 'activity' ? '🎁' : value === 'announcement' ? '📢' : '🔔');
</script>

<template>
    <PageShell>
        <ion-header class="ion-no-border">
            <ion-toolbar>
                <ion-title class="!text-lg font-black">
                    {{ t('notifications.title') }}
                    <span v-if="unread" class="ml-1 text-xs text-[color:var(--danger)]">({{ unread }})</span>
                </ion-title>
                <template v-slot:end>
                    <button type="button" class="app-btn app-btn-ghost mr-1 !px-2 !py-1 !text-[11px]" :disabled="!unread" @click="markAllRead">
                        {{ t('notifications.markAllRead') }}
                    </button>
                </template>
            </ion-toolbar>
            <div class="flex items-center gap-2 px-4 pb-2">
                <button type="button" class="app-chip" :class="filterUnread ? 'app-chip-brand' : ''" @click="filterUnread = !filterUnread">
                    {{ t('notifications.filterUnread') }}
                </button>
                <button type="button" class="app-chip" :class="type !== 'all' ? 'app-chip-brand' : ''" @click="showTypeSheet = true">🏷 {{ typeLabel }}</button>
            </div>
        </ion-header>

        <ion-content>
            <template v-slot:fixed>
                <ion-refresher @ion-refresh="handleRefresh">
                    <ion-refresher-content pulling-text="下拉刷新" refreshing-spinner="crescent" />
                </ion-refresher>
            </template>

            <div class="space-y-2 p-4">
                <div v-if="error" class="app-alert app-alert-danger text-[11px]">{{ error }}</div>
                <div v-if="success" class="app-alert app-alert-success text-[11px]">{{ success }}</div>

                <div v-if="loading && !items.length" class="space-y-2">
                    <div v-for="i in 5" :key="i" class="app-skeleton h-20" />
                </div>

                <div v-else-if="items.length" class="space-y-2">
                    <div
                        v-for="item in items"
                        :key="item.id"
                        class="app-card p-3 transition-opacity"
                        :class="[item.read ? 'opacity-65' : '', levelBorder[item.level] ?? '']"
                        @click="markRead(item)"
                    >
                        <div class="flex items-start gap-2.5">
                            <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--surface-3)] text-sm">
                                {{ iconFor(item.type) }}
                            </span>
                            <div class="min-w-0 flex-1">
                                <div class="flex items-start gap-1.5">
                                    <p class="flex-1 text-[11px] leading-snug font-bold">{{ item.title }}</p>
                                    <span v-if="!item.read" class="mt-1 h-2 w-2 shrink-0 rounded-full bg-[color:var(--danger)]" />
                                </div>
                                <p v-if="item.content" class="text-muted-2 mt-1 text-[10px] leading-relaxed whitespace-pre-wrap">{{ item.content }}</p>
                                <div class="mt-1.5 flex items-center gap-2">
                                    <span class="text-faint text-[9px]">{{ formatRelativeTime(item.createdAt) }}</span>
                                    <a
                                        v-if="item.linkUrl"
                                        :href="item.linkUrl"
                                        class="text-primary-600 text-[9px] font-bold underline"
                                        target="_blank"
                                        rel="noopener"
                                        @click.stop
                                    >
                                        {{ t('common.viewDetail') }}
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div v-else class="text-faint py-16 text-center text-xs">
                    <p class="mb-2 text-3xl">🔔</p>
                    <p class="font-bold">{{ t('notifications.empty') }}</p>
                    <p class="mt-1">{{ t('notifications.emptyHint') }}</p>
                </div>

                <div v-if="totalPages > 1" class="flex items-center justify-center gap-3 pt-2 text-xs">
                    <button
                        type="button"
                        class="app-btn app-btn-outline !px-3 !py-1"
                        :disabled="page <= 1"
                        @click="
                            page -= 1;
                            load();
                        "
                    >
                        ‹
                    </button>
                    <span>{{ page }} / {{ totalPages }}</span>
                    <button
                        type="button"
                        class="app-btn app-btn-outline !px-3 !py-1"
                        :disabled="page >= totalPages"
                        @click="
                            page += 1;
                            load();
                        "
                    >
                        ›
                    </button>
                </div>
            </div>
        </ion-content>

        <ion-action-sheet :is-open="showTypeSheet" :header="t('notifications.typeLabel')" :buttons="typeActions" @did-dismiss="showTypeSheet = false" />
    </PageShell>
</template>
