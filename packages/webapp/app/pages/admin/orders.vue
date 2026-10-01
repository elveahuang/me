<script setup lang="ts">
import { extractApiError, formatDateTime, formatYuan, orderStatusLabelKey, orderStatusTone } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ layout: 'admin', middleware: 'admin' });

const { t } = useI18n();

interface AdminOrderRow {
    id: string;
    orderNo: string;
    userEmail: string | null;
    planCode: string;
    period: string;
    amountCents: number;
    status: string;
    provider: string;
    providerTradeNo: string | null;
    paidAt: string | null;
    createdAt: string;
}

/** 与 admin/orders.get.ts 的 stats 字段一一对应，营收/笔数由服务端 SQL 聚合 */
interface AdminOrderStats {
    total: number;
    paidCount: number;
    pendingCount: number;
    closedCount: number;
    refundedCount: number;
    paidAmountCents: number;
}

interface AdminOrdersResponse {
    orders: AdminOrderRow[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    stats: AdminOrderStats;
}

const orders = ref<AdminOrderRow[]>([]);
const stats = ref<AdminOrderStats | null>(null);
const pagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
const loading = ref(true);
const loadError = ref('');
const statusFilter = ref('all');
const searchKeyword = ref('');
const dateFrom = ref('');
const dateTo = ref('');
const cleaning = ref(false);
const cleanMessage = ref('');
const cleanError = ref('');

/** 两个映射存的是 t() 的 i18n 键（而非文案），切换语言即时生效 */
const PERIOD_LABEL: Record<string, string> = { monthly: 'adminForm.orderPeriodMonthly', yearly: 'adminForm.orderPeriodYearly' };

const PROVIDER_LABEL: Record<string, string> = { wechat: 'adminForm.orderProviderWechat', mock: 'adminForm.orderProviderMock' };

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
    cleanMessage.value = '';
    try {
        const res = await $fetch<AdminOrdersResponse>('/api/admin/orders', {
            query: {
                page,
                pageSize: pagination.value.pageSize,
                status: statusFilter.value === 'all' ? undefined : statusFilter.value,
                keyword: searchKeyword.value.trim() || undefined,
                dateFrom: dateFrom.value || undefined,
                dateTo: dateTo.value || undefined,
            },
        });
        if (seq !== loadSeq) return;
        orders.value = res.orders;
        stats.value = res.stats;
        pagination.value = { page: res.page, pageSize: res.pageSize, total: res.total, totalPages: res.totalPages };
    } catch (e) {
        if (seq !== loadSeq) return;
        // 失败时必须给出可见提示：否则表格走空态分支，把「请求失败」显示成「没有订单」
        orders.value = [];
        stats.value = null;
        loadError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        if (seq === loadSeq) loading.value = false;
    }
}

/** 切换筛选条件后回到第一页，否则可能停在超出范围的页码上看到空列表 */
function applyFilter() {
    load(1);
}

function changeStatusFilter(status: string) {
    statusFilter.value = status;
    applyFilter();
}

function clearFilters() {
    searchKeyword.value = '';
    statusFilter.value = 'all';
    dateFrom.value = '';
    dateTo.value = '';
    applyFilter();
}

const hasFilters = computed(() => Boolean(searchKeyword.value.trim() || dateFrom.value || dateTo.value || statusFilter.value !== 'all'));

/** 清理超时未支付订单：渠道不可达时 pending 脏单没有其它自动出口 */
async function cleanStaleOrders() {
    cleaning.value = true;
    cleanError.value = '';
    cleanMessage.value = '';
    try {
        const res = await $fetch<{ ok: boolean; closedCount: number }>('/api/admin/orders/clean-stale', { method: 'POST' });
        cleanMessage.value = res.closedCount > 0 ? t('admin.cleanStaleDone', { count: res.closedCount }) : t('admin.cleanStaleNone');
        await load(1);
    } catch (e) {
        cleanError.value = extractApiError(e, t('common.error'));
    } finally {
        cleaning.value = false;
    }
}

onMounted(() => load(1));
onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
    <div class="space-y-6">
        <div v-if="loadError" class="app-alert app-alert-danger">
            {{ loadError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load()">{{ t('common.retry') }}</button>
        </div>
        <div class="app-page-header !mb-0">
            <div>
                <h1 class="app-page-title text-strong">{{ t('nav.orders') }}</h1>
                <p class="app-page-subtitle">{{ t('adminForm.ordersSubtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <button type="button" class="app-btn app-btn-outline app-btn-sm" :disabled="cleaning" @click="cleanStaleOrders">
                    🧹 {{ cleaning ? t('common.loading') : t('admin.cleanStale') }}
                </button>
                <button type="button" class="app-btn app-btn-outline app-btn-sm" @click="load()">🔄 {{ t('common.refresh') }}</button>
            </div>
        </div>

        <div v-if="cleanMessage" class="app-alert app-alert-success">{{ cleanMessage }}</div>
        <div v-if="cleanError" class="app-alert app-alert-danger">{{ cleanError }}</div>

        <!-- 汇总指标：数值统一深灰，状态色只在表格徽章上出现 -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('admin.totalRevenue') }}</p>
                    <p class="app-stat-value text-strong tabular-nums">¥{{ formatYuan(stats?.paidAmountCents) }}</p>
                    <p class="text-faint mt-1 text-[11px]">{{ hasFilters ? t('admin.statsFiltered') : t('admin.revenueHint') }}</p>
                </div>
                <span class="app-stat-icon">💰</span>
            </div>
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('admin.paidOrders') }}</p>
                    <p class="app-stat-value text-strong tabular-nums">{{ stats?.paidCount ?? 0 }}</p>
                    <p class="text-faint mt-1 text-[11px]">{{ t('admin.paidOrdersHint') }}</p>
                </div>
                <span class="app-stat-icon">✅</span>
            </div>
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('admin.pendingOrders') }}</p>
                    <p class="app-stat-value text-strong tabular-nums">{{ stats?.pendingCount ?? 0 }}</p>
                    <p class="text-faint mt-1 text-[11px]">{{ t('admin.pendingOrdersHint') }}</p>
                </div>
                <span class="app-stat-icon">⏳</span>
            </div>
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('admin.refundedOrders') }}</p>
                    <p class="app-stat-value text-strong tabular-nums">{{ stats?.refundedCount ?? 0 }}</p>
                    <p class="text-faint mt-1 text-[11px]">{{ t('admin.refundedOrdersHint') }}</p>
                </div>
                <span class="app-stat-icon">↩️</span>
            </div>
        </div>

        <!-- 筛选与搜索工具条 -->
        <div class="app-card flex flex-col gap-3 p-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div class="app-segmented overflow-x-auto">
                    <button
                        v-for="st in ['all', 'paid', 'pending', 'closed', 'refunded']"
                        :key="st"
                        type="button"
                        class="app-segmented-item"
                        :aria-pressed="statusFilter === st"
                        @click="changeStatusFilter(st)"
                    >
                        {{ st === 'all' ? t('common.all') : t(orderStatusLabelKey(st)) }}
                    </button>
                </div>

                <div class="relative w-full lg:w-72">
                    <input
                        v-model="searchKeyword"
                        :placeholder="t('admin.searchOrders')"
                        :aria-label="t('admin.searchOrders')"
                        class="app-input !py-2 !pr-8 !text-xs"
                        @input="onKeywordInput"
                    />
                    <button
                        v-if="searchKeyword"
                        type="button"
                        class="text-faint absolute top-1/2 right-2.5 -translate-y-1/2 text-xs hover:opacity-70"
                        :aria-label="t('common.clear')"
                        @click="
                            searchKeyword = '';
                            applyFilter();
                        "
                    >
                        ✕
                    </button>
                </div>
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-faint text-[11px] font-semibold">{{ t('admin.dateRange') }}</span>
                    <input v-model="dateFrom" type="date" :aria-label="t('admin.dateFrom')" class="app-input !w-auto !py-1.5 !text-xs" @change="applyFilter" />
                    <span class="text-faint text-xs">—</span>
                    <input v-model="dateTo" type="date" :aria-label="t('admin.dateTo')" class="app-input !w-auto !py-1.5 !text-xs" @change="applyFilter" />
                    <button v-if="hasFilters" type="button" class="app-btn app-btn-ghost app-btn-sm" @click="clearFilters">
                        {{ t('agents.resetFilter') }}
                    </button>
                </div>
                <p class="text-faint text-[11px]">
                    {{ t('admin.totalCount', { count: pagination.total }) }}
                </p>
            </div>
        </div>

        <!-- 订单列表表格 -->
        <div class="app-table-wrap">
            <table class="app-table">
                <thead>
                    <tr>
                        <th>{{ t('billing.orderNo') }}</th>
                        <th>{{ t('adminForm.colUserEmail') }}</th>
                        <th>{{ t('nav.plans') }}</th>
                        <th>{{ t('adminForm.colPeriod') }}</th>
                        <th>{{ t('billing.amount') }}</th>
                        <th>{{ t('adminForm.colChannel') }}</th>
                        <th>{{ t('common.status') }}</th>
                        <th>{{ t('adminForm.colTradeNo') }}</th>
                        <th>{{ t('adminForm.colCreatedAt') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="o in orders" :key="o.id">
                        <td class="text-strong font-mono font-bold">{{ o.orderNo }}</td>
                        <td class="text-soft font-medium">{{ o.userEmail || '—' }}</td>
                        <td>
                            <span class="app-chip">{{ o.planCode }}</span>
                        </td>
                        <td class="text-soft font-medium">{{ PERIOD_LABEL[o.period] ? t(PERIOD_LABEL[o.period]!) : o.period }}</td>
                        <td class="text-strong font-black tabular-nums">¥{{ formatYuan(o.amountCents) }}</td>
                        <td class="text-muted-2">{{ PROVIDER_LABEL[o.provider] ? t(PROVIDER_LABEL[o.provider]!) : o.provider }}</td>
                        <td>
                            <span :class="orderStatusTone(o.status)" class="app-badge">
                                {{ t(orderStatusLabelKey(o.status)) }}
                            </span>
                        </td>
                        <td class="app-table-cell-wrap text-faint font-mono text-[10px]" :title="o.providerTradeNo || ''">
                            {{ o.providerTradeNo || '—' }}
                        </td>
                        <td class="text-faint">{{ formatDateTime(o.createdAt) }}</td>
                    </tr>
                    <tr v-if="!orders.length && !loading">
                        <td colspan="9" class="!whitespace-normal">
                            <!-- 加载失败与「筛选无结果」必须区分：否则用户会把故障当成没有数据 -->
                            <div v-if="loadError" class="app-empty">
                                <span class="app-empty-icon">⚠️</span>
                                <p class="app-empty-title !text-[color:var(--danger)]">{{ loadError }}</p>
                                <button type="button" class="app-link mt-3 text-xs" @click="load()">{{ t('common.retry') }}</button>
                            </div>
                            <div v-else class="app-empty">
                                <span class="app-empty-icon">🧾</span>
                                <p class="app-empty-title">{{ t('admin.noData') }}</p>
                                <p class="app-empty-desc">{{ hasFilters ? t('admin.noFilteredOrders') : t('admin.noOrders') }}</p>
                                <button v-if="hasFilters" type="button" class="app-link mt-3 text-xs" @click="clearFilters">
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

        <!-- 分页：统计与列表都由服务端分页返回，订单量增长后不再只看到最早的一页 -->
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
