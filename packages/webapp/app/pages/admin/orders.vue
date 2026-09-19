<script setup lang="ts">
import { extractApiError, orderStatusLabelKey, orderStatusTone } from '@commons/contract';
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

const orders = ref<AdminOrderRow[]>([]);
const loading = ref(true);
const loadError = ref('');
const statusFilter = ref('all');
const searchKeyword = ref('');

const PERIOD_LABEL: Record<string, string> = { monthly: '按月', yearly: '按年' };

const PROVIDER_LABEL: Record<string, string> = { wechat: '微信支付', mock: '模拟支付' };

function formatDateTime(value: string | null) {
    if (!value) return '—';
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

const filteredOrders = computed(() => {
    let list = orders.value;
    if (statusFilter.value !== 'all') {
        list = list.filter((o) => o.status === statusFilter.value);
    }
    const q = searchKeyword.value.trim().toLowerCase();
    if (q) {
        list = list.filter(
            (o) => o.orderNo.toLowerCase().includes(q) || (o.userEmail && o.userEmail.toLowerCase().includes(q)) || o.planCode.toLowerCase().includes(q),
        );
    }
    return list;
});

const totalRevenue = computed(() => {
    return orders.value.filter((o) => o.status === 'paid').reduce((sum, o) => sum + o.amountCents, 0) / 100;
});

const paidCount = computed(() => orders.value.filter((o) => o.status === 'paid').length);
const pendingCount = computed(() => orders.value.filter((o) => o.status === 'pending').length);

async function load() {
    loading.value = true;
    loadError.value = '';
    try {
        const res = await $fetch<{ orders: AdminOrderRow[] }>('/api/admin/orders');
        orders.value = res.orders;
    } catch (e) {
        // 失败时必须给出可见提示：否则表格走空态分支，把「请求失败」显示成「没有订单」
        orders.value = [];
        loadError.value = extractApiError(e, t('common.loadFailed'));
    } finally {
        loading.value = false;
    }
}

onMounted(load);
</script>

<template>
    <div class="space-y-6">
        <div v-if="loadError" class="app-alert app-alert-danger">
            {{ loadError }}
            <button type="button" class="ml-2 underline hover:no-underline" @click="load">{{ t('common.retry') }}</button>
        </div>
        <div class="app-page-header !mb-0">
            <div>
                <h1 class="app-page-title text-strong">{{ t('nav.orders') }}</h1>
                <p class="app-page-subtitle">全站充值与订阅订单流水，支持快捷多维检索、状态筛选与实时对账</p>
            </div>
            <div class="app-page-actions">
                <button type="button" class="app-btn app-btn-outline app-btn-sm" @click="load">🔄 {{ t('common.refresh') }}</button>
            </div>
        </div>

        <!-- 汇总指标：数值统一深灰，状态色只在表格徽章上出现 -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('admin.totalRevenue') }}</p>
                    <p class="app-stat-value text-strong tabular-nums">¥{{ totalRevenue.toFixed(2) }}</p>
                    <p class="text-faint mt-1 text-[11px]">✓ 累计成功到账金额</p>
                </div>
                <span class="app-stat-icon">💰</span>
            </div>
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('admin.paidOrders') }}</p>
                    <p class="app-stat-value text-strong tabular-nums">{{ paidCount }}</p>
                    <p class="text-faint mt-1 text-[11px]">笔成功交易流水</p>
                </div>
                <span class="app-stat-icon">✅</span>
            </div>
            <div class="app-stat">
                <div>
                    <p class="app-stat-label">{{ t('admin.pendingOrders') }}</p>
                    <p class="app-stat-value text-strong tabular-nums">{{ pendingCount }}</p>
                    <p class="text-faint mt-1 text-[11px]">笔等待完成支付</p>
                </div>
                <span class="app-stat-icon">⏳</span>
            </div>
        </div>

        <!-- 筛选与搜索工具条 -->
        <div class="app-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="app-segmented">
                <button
                    v-for="st in ['all', 'paid', 'pending', 'closed', 'refunded']"
                    :key="st"
                    type="button"
                    class="app-segmented-item"
                    :aria-pressed="statusFilter === st"
                    @click="statusFilter = st"
                >
                    {{ st === 'all' ? t('common.all') : t(orderStatusLabelKey(st)) }}
                </button>
            </div>

            <div class="relative w-full sm:w-72">
                <input v-model="searchKeyword" :placeholder="t('admin.searchOrders')" class="app-input !py-2 pr-8 !text-xs" />
                <button
                    v-if="searchKeyword"
                    type="button"
                    class="text-faint absolute top-1/2 right-2.5 -translate-y-1/2 text-xs hover:opacity-70"
                    @click="searchKeyword = ''"
                >
                    ✕
                </button>
            </div>
        </div>

        <!-- 订单列表表格 -->
        <div class="app-table-wrap">
            <table class="app-table">
                <thead>
                    <tr>
                        <th>{{ t('billing.orderNo') }}</th>
                        <th>用户邮箱</th>
                        <th>{{ t('nav.plans') }}</th>
                        <th>周期</th>
                        <th>{{ t('billing.amount') }}</th>
                        <th>渠道</th>
                        <th>{{ t('common.status') }}</th>
                        <th>支付流水号</th>
                        <th>下单时间</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="o in filteredOrders" :key="o.id">
                        <td class="text-strong font-mono font-bold">{{ o.orderNo }}</td>
                        <td class="text-soft font-medium">{{ o.userEmail || '—' }}</td>
                        <td>
                            <span class="app-chip">{{ o.planCode }}</span>
                        </td>
                        <td class="text-soft font-medium">{{ PERIOD_LABEL[o.period] || o.period }}</td>
                        <td class="text-strong font-black tabular-nums">¥{{ (o.amountCents / 100).toFixed(2) }}</td>
                        <td class="text-muted-2">{{ PROVIDER_LABEL[o.provider] || o.provider }}</td>
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
                    <tr v-if="!filteredOrders.length && !loading">
                        <td colspan="9" class="!whitespace-normal">
                            <!-- 加载失败与「筛选无结果」必须区分：否则用户会把故障当成没有数据 -->
                            <div v-if="loadError" class="app-empty">
                                <span class="app-empty-icon">⚠️</span>
                                <p class="app-empty-title !text-[color:var(--danger)]">{{ loadError }}</p>
                                <button type="button" class="app-link mt-3 text-xs" @click="load">{{ t('common.retry') }}</button>
                            </div>
                            <div v-else class="app-empty">
                                <span class="app-empty-icon">🧾</span>
                                <p class="app-empty-title">{{ t('admin.noData') }}</p>
                                <p class="app-empty-desc">未找到符合当前过滤条件的订单流水</p>
                                <button
                                    v-if="searchKeyword || statusFilter !== 'all'"
                                    type="button"
                                    class="app-link mt-3 text-xs"
                                    @click="
                                        searchKeyword = '';
                                        statusFilter = 'all';
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
