<script setup lang="ts">
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
const statusFilter = ref('all');
const searchKeyword = ref('');

const PERIOD_LABEL: Record<string, string> = { monthly: '按月', yearly: '按年' };
const STATUS_LABEL: Record<string, string> = { pending: '待支付', paid: '已支付', closed: '已关闭', refunded: '已退款' };
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
    try {
        const res = await $fetch<{ orders: AdminOrderRow[] }>('/api/admin/orders');
        orders.value = res.orders;
    } catch (e: any) {
        console.error('加载订单失败:', e);
    } finally {
        loading.value = false;
    }
}

onMounted(load);
</script>

<template>
    <div class="space-y-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <h1 class="text-2xl font-black tracking-tight text-slate-900">{{ t('nav.orders') }}</h1>
                <p class="mt-1 text-xs text-slate-500">全站充值与订阅订单流水，支持快捷多维检索、状态筛选与实时对账</p>
            </div>
            <button
                type="button"
                class="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 active:scale-95"
                @click="load"
            >
                🔄 {{ t('common.refresh') }}
            </button>
        </div>

        <!-- 汇总数据指标卡 -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
                <p class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">{{ t('admin.totalRevenue') }}</p>
                <p class="mt-2 text-2xl font-black text-slate-900">¥{{ totalRevenue.toFixed(2) }}</p>
                <p class="mt-1 text-[11px] font-semibold text-emerald-600">✓ 累计成功到账金额</p>
            </div>
            <div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
                <p class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">{{ t('admin.paidOrders') }}</p>
                <p class="mt-2 text-2xl font-black text-emerald-600">{{ paidCount }}</p>
                <p class="mt-1 text-[11px] font-medium text-slate-400">笔成功交易流水</p>
            </div>
            <div class="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
                <p class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">{{ t('admin.pendingOrders') }}</p>
                <p class="mt-2 text-2xl font-black text-amber-500">{{ pendingCount }}</p>
                <p class="mt-1 text-[11px] font-medium text-slate-400">笔等待完成支付</p>
            </div>
        </div>

        <!-- 筛选与搜索工具条 -->
        <div class="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
            <!-- 状态切换 Tab -->
            <div class="flex flex-wrap gap-1">
                <button
                    v-for="st in ['all', 'paid', 'pending', 'closed', 'refunded']"
                    :key="st"
                    type="button"
                    :class="[
                        'rounded-xl px-3 py-1.5 text-xs font-bold transition-all',
                        statusFilter === st ? 'bg-primary-50 text-primary-700 shadow-2xs' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
                    ]"
                    @click="statusFilter = st"
                >
                    {{ st === 'all' ? t('common.all') : STATUS_LABEL[st] || st }}
                </button>
            </div>

            <!-- 搜索框 -->
            <div class="relative w-full sm:w-72">
                <input
                    v-model="searchKeyword"
                    :placeholder="t('admin.searchOrders')"
                    class="focus:border-primary-500 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 transition-colors focus:bg-white focus:outline-none"
                />
                <button
                    v-if="searchKeyword"
                    type="button"
                    class="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                    @click="searchKeyword = ''"
                >
                    ✕
                </button>
            </div>
        </div>

        <!-- 订单列表表格 -->
        <div class="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xs">
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-50 text-[11px] font-bold text-slate-400 uppercase">
                        <tr>
                            <th class="p-4">{{ t('billing.orderNo') }}</th>
                            <th class="p-4">用户邮箱</th>
                            <th class="p-4">{{ t('nav.plans') }}</th>
                            <th class="p-4">周期</th>
                            <th class="p-4">{{ t('billing.amount') }}</th>
                            <th class="p-4">渠道</th>
                            <th class="p-4">{{ t('common.status') }}</th>
                            <th class="p-4">支付流水号</th>
                            <th class="p-4">下单时间</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 text-slate-700">
                        <tr v-for="o in filteredOrders" :key="o.id" class="transition-colors hover:bg-slate-50/60">
                            <td class="p-4 font-mono font-bold text-slate-900">{{ o.orderNo }}</td>
                            <td class="p-4 font-medium">{{ o.userEmail || '—' }}</td>
                            <td class="p-4">
                                <span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                                    {{ o.planCode }}
                                </span>
                            </td>
                            <td class="p-4 font-medium">{{ PERIOD_LABEL[o.period] || o.period }}</td>
                            <td class="p-4 font-black text-slate-900">¥{{ (o.amountCents / 100).toFixed(2) }}</td>
                            <td class="p-4 text-slate-500">{{ PROVIDER_LABEL[o.provider] || o.provider }}</td>
                            <td class="p-4">
                                <span
                                    :class="[
                                        'rounded-full px-2.5 py-0.5 text-[10px] font-bold',
                                        o.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : '',
                                        o.status === 'pending' ? 'bg-amber-100 text-amber-700' : '',
                                        o.status === 'closed' ? 'bg-slate-100 text-slate-500' : '',
                                        o.status === 'refunded' ? 'bg-rose-100 text-rose-700' : '',
                                    ]"
                                >
                                    {{ STATUS_LABEL[o.status] || o.status }}
                                </span>
                            </td>
                            <td class="max-w-[150px] truncate p-4 font-mono text-[10px] text-slate-400" :title="o.providerTradeNo || ''">
                                {{ o.providerTradeNo || '—' }}
                            </td>
                            <td class="p-4 whitespace-nowrap text-slate-400">{{ formatDateTime(o.createdAt) }}</td>
                        </tr>
                        <tr v-if="!filteredOrders.length && !loading">
                            <td colspan="9" class="p-14 text-center">
                                <div class="mx-auto flex flex-col items-center">
                                    <span class="mb-2 text-3xl">🧾</span>
                                    <p class="text-sm font-bold text-slate-700">{{ t('admin.noData') }}</p>
                                    <p class="mt-1 text-xs text-slate-400">未找到符合当前过滤条件的订单流水</p>
                                    <button
                                        v-if="searchKeyword || statusFilter !== 'all'"
                                        type="button"
                                        class="text-primary-600 mt-3 text-xs font-bold hover:underline"
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
            </div>
        </div>
    </div>
</template>
