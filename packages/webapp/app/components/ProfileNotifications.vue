<script setup lang="ts">
import { extractApiError, formatRelativeTime, NOTIFICATION_TYPES, type NotificationRecord } from '@commons/contract';
import { useI18n } from 'vue-i18n';

/**
 * 个人中心「消息通知」分区的内容（原独立 /notifications 页面迁入）。
 * 未读数直接读写 shell-unread 共享状态，头部铃铛角标随已读操作实时更新。
 */
const { t } = useI18n();

const items = ref<NotificationRecord[]>([]);
const total = ref(0);
const unread = useState('shell-unread', () => 0);
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

/** 筛选（全部/未读、类型）与翻页共用 load()，旧请求后回会把上一个筛选的结果写回来 */
let loadSeq = 0;

async function load() {
    const seq = ++loadSeq;
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
        if (seq !== loadSeq) return;
        items.value = res.items;
        total.value = res.total;
        unread.value = res.unread;
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

/** 成功提示自动消失；卸载时清理，避免定时器在组件销毁后写状态 */
let successTimer: ReturnType<typeof setTimeout> | null = null;
function flashSuccess(text: string, ms = 2500) {
    success.value = text;
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(() => (success.value = ''), ms);
}
onBeforeUnmount(() => {
    if (successTimer) clearTimeout(successTimer);
});

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

/** 全部已读是 POST，请求期间按钮仍可点：连点会重复发同一批已读写入 */
const markingAll = ref(false);

async function markAllRead() {
    if (markingAll.value) return;
    markingAll.value = true;
    try {
        const res = await $fetch<{ updated: number; unread: number }>('/api/notifications/read', { method: 'POST', body: {} });
        items.value = items.value.map((item) => ({ ...item, read: true, readAt: item.readAt ?? new Date().toISOString() }));
        unread.value = res.unread;
        flashSuccess(t('notifications.allRead'));
        if (filter.value === 'unread') await load();
    } catch (e) {
        error.value = extractApiError(e, t('common.error'));
    } finally {
        markingAll.value = false;
    }
}

const typeLabel = (value: string) => {
    const found = NOTIFICATION_TYPES.find((item) => item.value === value);
    return found ? found.label : value;
};
</script>

<template>
    <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 class="flex items-center gap-2 text-base font-black">
                    <span>{{ t('notifications.title') }}</span>
                    <span v-if="unread" class="app-badge app-badge-danger">{{ unread }}</span>
                </h2>
                <p class="text-faint mt-0.5 text-xs">{{ t('notifications.subtitle') }}</p>
            </div>
            <button type="button" class="app-btn app-btn-outline" :disabled="!unread || markingAll" @click="markAllRead">
                <AppIcon name="check-all" :size="16" />
                <span>{{ t('notifications.markAllRead') }}</span>
            </button>
        </div>

        <div v-if="error" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ error }}</span>
            <button type="button" class="app-btn app-btn-soft shrink-0 !px-3 !py-1 !text-[10px]" @click="load">{{ t('common.retry') }}</button>
        </div>
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

        <!-- 失败时不渲染空态：「暂无消息」会把接口故障读成「确实没有通知」 -->
        <div v-else-if="!error" class="app-card flex flex-col items-center gap-2 p-12 text-center">
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
