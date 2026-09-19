<script setup lang="ts">
import { formatDate, formatYuan, orderStatusLabelKey, orderStatusTone, type OrdersResponse } from '@commons/contract';
import { useI18n } from 'vue-i18n';

definePageMeta({ middleware: 'auth' });

const { t } = useI18n();
const props = defineProps<{ orders: OrdersResponse | null }>();

const orderList = computed(() => props.orders?.orders ?? []);
</script>

<template>
    <div class="app-card p-6 sm:p-8">
        <h2 class="text-base font-black">{{ t('nav.orders') }}</h2>
        <p class="text-faint mt-0.5 text-xs">最近订单明细记录</p>

        <div class="mt-4 overflow-x-auto">
            <table v-if="orderList.length" class="app-table">
                <thead>
                    <tr>
                        <th>{{ t('billing.orderNo') }}</th>
                        <th>周期</th>
                        <th>{{ t('billing.amount') }}</th>
                        <th>渠道</th>
                        <th>{{ t('common.status') }}</th>
                        <th>创建时间</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="order in orderList" :key="order.id">
                        <td class="text-muted-2 font-mono">{{ order.orderNo }}</td>
                        <td>{{ order.period === 'yearly' ? t('billing.yearly') : t('billing.monthly') }}</td>
                        <td class="font-black">¥{{ formatYuan(order.amountCents) }}</td>
                        <td>
                            <span v-if="order.provider === 'wechat'" class="text-brand">{{ t('billing.wechatPay') }}</span>
                            <span v-else-if="order.provider === 'mock'" class="text-soft">{{ t('billing.mockPay') }}</span>
                            <span v-else class="text-muted-2">{{ order.provider }}</span>
                        </td>
                        <td>
                            <span :class="['app-badge', orderStatusTone(order.status)]">{{ t(orderStatusLabelKey(order.status)) }}</span>
                        </td>
                        <td class="text-faint">{{ formatDate(order.createdAt) }}</td>
                    </tr>
                </tbody>
            </table>
            <div v-else class="text-faint py-8 text-center text-xs">{{ t('admin.tableEmpty') }}</div>
        </div>
    </div>
</template>
