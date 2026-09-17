<script setup lang="ts">
import { extractApiError, formatRelativeTime, NOTIFICATION_TYPES, type NotificationRecord } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const { t } = useI18n();

const items = ref<NotificationRecord[]>([]);
const total = ref(0);
const unread = ref(0);
const page = ref(1);
const pageSize = 15;
const loading = ref(false);
const error = ref('');
const success = ref('');
const filter = ref<'all' | 'unread'>('all');
const type = ref('all');

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const activeTypes = computed(() => NOTIFICATION_TYPES);

const levelClass: Record<string, string> = {
    info: 'app-badge-info',
    success: 'app-badge-success',
    warning: 'app-badge-warning',
    danger: 'app-badge-danger',
};

async function load() {
    loading.value = true;
    error.value = '';
    try {
        const res = await $fetch<{ items: NotificationRecord[]; total: number; unread: number }>('/api/notifications', {
            query: {
                page: page.value,
                pageSize,
                unread: filter.value === 'unread' ? 1 : undefined,
                type: type.value === 'all' ? undefined : type.value,
            },
        });
        items.value = res.items;
        total.value = res.total;
        unread.value = res.unread;
    } catch (e) {
        error.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);

watch([filter, type], () => {
    page.value = 1;
    void load();
});

function goPage(next: number) {
    if (next < 1 || next > totalPages.value) return;
    page.value = next;
    void load();
}

async function markRead(item: NotificationRecord) {
    if (item.read) return;
    try {
        const res = await $fetch<{ unread: number }>('/api/notifications/read', { method: 'POST', body: { ids: [item.id] } });
        item.read = true;
        item.readAt = new Date().toISOString();
        unread.value = res.unread;
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

async function markAllRead() {
    try {
        const res = await $fetch<{ updated: number; unread: number }>('/api/notifications/read', { method: 'POST', body: {} });
        items.value = items.value.map((item) => ({ ...item, read: true, readAt: item.readAt ?? new Date().toISOString() }));
        unread.value = res.unread;
        success.value = t('notifications.allRead');
        setTimeout(() => (success.value = ''), 2500);
        if (filter.value === 'unread') await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    }
}

const typeLabel = (value: string) => {
    const found = NOTIFICATION_TYPES.find((item) => item.value === value);
    return found ? found.label : value;
};
</script>

<template>
    <div class="mx-auto max-w-3xl space-y-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h1 class="flex items-center gap-2 text-2xl font-black tracking-tight">
                    <span>{{ t('notifications.title') }}</span>
                    <span v-if="unread" class="app-badge app-badge-danger">{{ unread }}</span>
                </h1>
                <p class="text-faint mt-1 text-xs">{{ t('notifications.subtitle') }}</p>
            </div>
            <button type="button" class="app-btn app-btn-outline" :disabled="!unread" @click="markAllRead">
                <AppIcon name="check-all" :size="16" />
                <span>{{ t('notifications.markAllRead') }}</span>
            </button>
        </div>

        <div v-if="error" class="app-alert app-alert-danger">{{ error }}</div>
        <div v-if="success" class="app-alert app-alert-success">{{ success }}</div>

        <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="app-chip transition-colors" :class="filter === 'all' ? 'app-chip-brand' : ''" @click="filter = 'all'">
                {{ t('notifications.filterAll') }}
            </button>
            <button type="button" class="app-chip transition-colors" :class="filter === 'unread' ? 'app-chip-brand' : ''" @click="filter = 'unread'">
                {{ t('notifications.filterUnread') }}
            </button>
            <span class="app-divider mx-1 h-4 w-px" />
            <button type="button" class="app-chip transition-colors" :class="type === 'all' ? 'app-chip-brand' : ''" @click="type = 'all'">
                {{ t('common.all') }}
            </button>
            <button
                v-for="tp in activeTypes"
                :key="tp.value"
                type="button"
                class="app-chip transition-colors"
                :class="type === tp.value ? 'app-chip-brand' : ''"
                @click="type = tp.value"
            >
                {{ tp.label }}
            </button>
        </div>

        <div v-if="loading" class="space-y-3">
            <div v-for="i in 5" :key="i" class="app-skeleton h-20" />
        </div>

        <div v-else-if="items.length" class="space-y-2">
            <div
                v-for="item in items"
                :key="item.id"
                class="app-card app-card-hover relative p-4 transition-opacity"
                :class="item.read ? 'opacity-70' : ''"
                @click="markRead(item)"
            >
                <div class="flex items-start gap-3">
                    <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--surface-3)]">
                        <AppIcon
                            :name="item.type === 'billing' ? 'credit-card-outline' : item.type === 'activity' ? 'gift-outline' : 'bell-outline'"
                            :size="16"
                        />
                    </span>
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <p class="text-xs font-bold" :class="item.read ? '' : 'text-strong'">{{ item.title }}</p>
                            <span :class="['app-badge !text-[10px]', levelClass[item.level] ?? 'app-badge-neutral']">{{ typeLabel(item.type) }}</span>
                            <span v-if="!item.read" class="app-badge app-badge-danger !text-[10px]">{{ t('notifications.unread') }}</span>
                        </div>
                        <p v-if="item.content" class="text-muted-2 mt-1.5 text-[11px] leading-relaxed whitespace-pre-wrap">{{ item.content }}</p>
                        <div class="mt-2 flex items-center gap-3 text-[10px]">
                            <span class="text-faint">{{ formatRelativeTime(item.createdAt) }}</span>
                            <a v-if="item.linkUrl" :href="item.linkUrl" class="app-link" target="_blank" rel="noopener" @click.stop>
                                {{ t('common.viewDetail') }}
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="app-card flex flex-col items-center gap-2 p-12 text-center">
            <AppIcon name="bell-outline" :size="34" class="text-faint" />
            <p class="text-sm font-bold">{{ t('notifications.empty') }}</p>
            <p class="text-faint text-xs">{{ t('notifications.emptyHint') }}</p>
        </div>

        <div v-if="totalPages > 1" class="flex items-center justify-center gap-2">
            <button type="button" class="app-btn app-btn-outline !px-3" :disabled="page <= 1" @click="goPage(page - 1)">
                <AppIcon name="chevron-left" :size="16" />
            </button>
            <span class="text-xs">{{ page }} / {{ totalPages }}</span>
            <button type="button" class="app-btn app-btn-outline !px-3" :disabled="page >= totalPages" @click="goPage(page + 1)">
                <AppIcon name="chevron-right" :size="16" />
            </button>
        </div>
    </div>
</template>
