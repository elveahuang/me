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

const PERIOD_LABEL: Record<string, string> = { monthly: '按月', yearly: '按年' };
const STATUS_LABEL: Record<string, string> = { pending: '待支付', paid: '已支付', closed: '已关闭', refunded: '已退款' };
const PROVIDER_LABEL: Record<string, string> = { wechat: '微信支付', mock: '模拟支付' };

function formatDateTime(value: string | null) {
    if (!value) return '—';
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

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
                <p class="mt-1 text-xs text-slate-500">全站充值与订阅订单流水（最近 200 条），实时对账与状态回溯</p>
            </div>
            <button
                type="button"
                class="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
                @click="load"
            >
                {{ t('common.refresh') }}
            </button>
        </div>

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
                        <tr v-for="o in orders" :key="o.id" class="transition-colors hover:bg-slate-50/60">
                            <td class="p-4 font-mono font-bold text-slate-900">{{ o.orderNo }}</td>
                            <td class="p-4 font-medium">{{ o.userEmail || '—' }}</td>
                            <td class="p-4">
                                <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold">
                                    {{ o.planCode }}
                                </span>
                            </td>
                            <td class="p-4">{{ PERIOD_LABEL[o.period] || o.period }}</td>
                            <td class="p-4 font-black text-slate-900">¥{{ (o.amountCents / 100).toFixed(2) }}</td>
                            <td class="p-4">{{ PROVIDER_LABEL[o.provider] || o.provider }}</td>
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
                        <tr v-if="!orders.length && !loading">
                            <td colspan="9" class="p-12 text-center text-xs text-slate-400">{{ t('admin.tableEmpty') }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>
