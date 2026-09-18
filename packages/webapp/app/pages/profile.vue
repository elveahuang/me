<script setup lang="ts">
import {
    BRAND_PRESETS,
    extractApiError,
    MODE_PRESETS,
    formatDate,
    formatYuan,
    quotaUsedPercent,
    type MeResponse,
    type OrdersResponse,
} from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { authClient, fetchSession, ssrCookieHeaders } from '~/utils/auth-client';

definePageMeta({ middleware: 'auth' });

const { t, locale } = useI18n();
const { $setLocale } = useNuxtApp();
const { brand, mode, setBrand, setMode } = useTheme();

const session = await fetchSession(ssrCookieHeaders());

// 聚合的用户信息与会员状态：两次 useFetch 互不依赖，并发发出而非串行等待；
// 捕获 error 以便接口失败时给出提示与重试，而不是静默显示 0 与「免费会员」误导用户。
const [me, orders] = await Promise.all([useFetch<MeResponse>('/api/me'), useFetch<OrdersResponse>('/api/billing/orders')]);
const meData = me.data;
const ordersData = orders.data;
const profileError = computed(() => {
    const err = me.error.value ?? orders.error.value;
    return err ? extractApiError(err, t('common.loadFailed')) : '';
});
async function retryProfile() {
    await Promise.all([me.refresh(), orders.refresh()]);
}

const membership = computed(() => meData.value?.membership ?? null);
const stats = computed(() => meData.value?.stats);
const orderList = computed(() => ordersData.value?.orders ?? []);

const quotaPercent = computed(() => quotaUsedPercent(membership.value?.usedToday, membership.value?.chatQuotaPerDay));

function handleLocaleChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    $setLocale(target.value as 'zh-CN' | 'en-US');
}

async function logout() {
    if (!confirm(t('profile.logoutConfirm'))) return;
    await authClient.signOut();
    await navigateTo('/login');
}

const statusTone: Record<string, string> = {
    paid: 'app-badge-success',
    pending: 'app-badge-warning',
    closed: 'app-badge-neutral',
    refunded: 'app-badge-info',
};

function orderStatusText(status: string): string {
    if (status === 'paid') return t('billing.statusPaid');
    if (status === 'pending') return t('billing.statusPending');
    return t('billing.statusClosed');
}
</script>

<template>
    <div class="mx-auto max-w-5xl space-y-7">
        <!-- 接口失败提示：不显示的话用户会把「加载失败」读成「没有数据/免费会员」 -->
        <div v-if="profileError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ profileError }}</span>
            <button type="button" class="app-btn app-btn-outline shrink-0 !py-1 text-xs" @click="retryProfile">{{ t('common.retry') }}</button>
        </div>

        <!-- 头部个人名片 -->
        <div class="app-card flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div class="flex items-center gap-5">
                <div class="app-avatar h-16 w-16 text-2xl">
                    {{ session?.user.name?.[0]?.toUpperCase() || 'U' }}
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h1 class="truncate text-xl font-black">{{ session?.user.name }}</h1>
                        <span v-if="session?.user.role === 'admin'" class="app-badge app-badge-danger uppercase">Admin</span>
                        <span v-if="membership?.plan" class="app-badge app-chip-brand">{{ membership.plan.name }}</span>
                    </div>
                    <p class="text-faint mt-1 truncate text-xs">{{ session?.user.email }}</p>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-2.5">
                <NuxtLink v-if="session?.user.role === 'admin'" to="/admin" class="app-btn app-btn-outline">{{ t('nav.admin') }}</NuxtLink>
                <NuxtLink to="/pricing" class="app-btn app-btn-primary">{{ t('nav.pricing') }}</NuxtLink>
                <button class="app-btn app-btn-danger" @click="logout">{{ t('nav.logout') }}</button>
            </div>
        </div>

        <!-- 统计指标网格 -->
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div class="app-card p-5">
                <div class="text-faint flex items-center justify-between text-xs font-medium">
                    <span>{{ t('nav.conversations') }}</span>
                    <span class="text-base">💬</span>
                </div>
                <div class="mt-2 text-2xl font-black">{{ stats?.totalConversations ?? 0 }}</div>
            </div>
            <div class="app-card p-5">
                <div class="text-faint flex items-center justify-between text-xs font-medium">
                    <span>{{ t('billing.usedToday') }}</span>
                    <span class="text-base">⚡</span>
                </div>
                <div class="mt-2 text-2xl font-black">{{ membership?.usedToday ?? 0 }}</div>
            </div>
            <div class="app-card p-5">
                <div class="text-faint flex items-center justify-between text-xs font-medium">
                    <span>{{ t('profile.memberLevel') }}</span>
                    <span class="text-base">👑</span>
                </div>
                <div class="mt-2 truncate text-base font-black">{{ membership?.plan?.name || t('billing.freePlan') }}</div>
            </div>
            <div class="app-card p-5">
                <div class="text-faint flex items-center justify-between text-xs font-medium">
                    <span>System Probe</span>
                    <span class="text-base">🩺</span>
                </div>
                <a href="/api/health" target="_blank" class="app-link mt-2 inline-flex items-center gap-1 text-xs">/api/health ›</a>
            </div>
        </div>

        <!-- 会员权益与偏好设置 -->
        <div class="grid gap-6 md:grid-cols-2">
            <!-- 额度卡片 -->
            <div class="app-card flex flex-col justify-between p-6">
                <div>
                    <h2 class="text-base font-black">{{ t('profile.quotaUsage') }}</h2>
                    <p class="text-faint mt-0.5 text-xs">{{ t('billing.subtitle') }}</p>

                    <div class="app-panel mt-5 p-4">
                        <div class="text-soft flex items-center justify-between text-xs font-semibold">
                            <span>{{ t('billing.usedToday') }}</span>
                            <span>
                                {{ membership?.usedToday ?? 0 }} /
                                {{ membership?.chatQuotaPerDay === null ? t('billing.unlimited') : `${membership?.chatQuotaPerDay ?? 0}` }}
                            </span>
                        </div>
                        <div class="app-progress mt-2.5">
                            <div
                                class="h-full rounded-full transition-all duration-500"
                                :style="{
                                    width: `${quotaPercent}%`,
                                    backgroundColor: quotaPercent >= 90 ? 'var(--danger)' : quotaPercent >= 70 ? 'var(--warning)' : 'var(--brand)',
                                }"
                            />
                        </div>
                    </div>
                </div>

                <div class="app-divider mt-6 flex items-center justify-between pt-4 text-xs">
                    <span class="text-faint">{{ t('billing.expiresAt') }}:</span>
                    <span class="font-bold">
                        {{ membership?.expiresAt ? formatDate(membership.expiresAt) : t('billing.unlimited') }}
                    </span>
                </div>
            </div>

            <!-- 偏好与主题设置 -->
            <div class="app-card flex flex-col justify-between p-6">
                <div>
                    <h2 class="text-base font-black">{{ t('profile.preferences') }}</h2>
                    <p class="text-faint mt-0.5 text-xs">界面主题、多语言与系统设置</p>

                    <div class="mt-5 space-y-4">
                        <!-- 深浅色 -->
                        <div class="app-panel flex items-center justify-between p-4">
                            <div>
                                <p class="text-xs font-bold">外观模式</p>
                                <p class="text-faint mt-0.5 text-[11px]">浅色 / 深色 / 跟随系统</p>
                            </div>
                            <div class="flex items-center gap-1">
                                <button
                                    v-for="option in MODE_PRESETS"
                                    :key="option.value"
                                    type="button"
                                    class="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors"
                                    :class="mode === option.value ? 'bg-brand' : 'text-muted-2 hover:text-strong'"
                                    :title="option.label"
                                    @click="setMode(option.value)"
                                >
                                    {{ option.icon }}
                                </button>
                            </div>
                        </div>

                        <!-- 品牌色 -->
                        <div class="app-panel flex items-center justify-between p-4">
                            <div>
                                <p class="text-xs font-bold">主题配色</p>
                                <p class="text-faint mt-0.5 text-[11px]">蓝色 / 绿色 / 黄色 / 红色</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <button
                                    v-for="preset in BRAND_PRESETS"
                                    :key="preset.value"
                                    type="button"
                                    class="app-theme-dot"
                                    :data-active="brand === preset.value"
                                    :style="{ backgroundColor: preset.swatch }"
                                    :title="preset.label"
                                    @click="setBrand(preset.value)"
                                />
                            </div>
                        </div>

                        <!-- 语言 -->
                        <div class="app-panel flex items-center justify-between p-4">
                            <div>
                                <p class="text-xs font-bold">{{ t('profile.languageSelect') }}</p>
                                <p class="text-faint mt-0.5 text-[11px]">English / 简体中文</p>
                            </div>
                            <select :value="locale" class="app-input !w-auto !py-1.5 !text-xs font-bold" @change="handleLocaleChange">
                                <option value="zh-CN">简体中文</option>
                                <option value="en-US">English</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="app-divider text-faint mt-6 flex items-center justify-between pt-4 text-xs">
                    <span>EE Agent Platform</span>
                    <span>v26.4.0</span>
                </div>
            </div>
        </div>

        <!-- 历史订单流水 -->
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
                                <span :class="['app-badge', statusTone[order.status] ?? 'app-badge-neutral']">{{ orderStatusText(order.status) }}</span>
                            </td>
                            <td class="text-faint">{{ formatDate(order.createdAt) }}</td>
                        </tr>
                    </tbody>
                </table>
                <div v-else class="text-faint py-8 text-center text-xs">{{ t('admin.tableEmpty') }}</div>
            </div>
        </div>
    </div>
</template>
