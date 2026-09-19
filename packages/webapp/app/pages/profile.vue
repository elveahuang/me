<script setup lang="ts">
import { extractApiError, type MeResponse, type OrdersResponse } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { authClient, fetchSession, ssrCookieHeaders } from '~/utils/auth-client';

definePageMeta({ middleware: 'auth' });

const { t } = useI18n();
const route = useRoute();

const session = await fetchSession(ssrCookieHeaders());

// 聚合的用户信息与会员状态：两次 useFetch 互不依赖，并发发出而非串行等待；
// 捕获 error 以便接口失败时给出提示与重试，而不是静默显示 0 与「免费会员」误导用户。
// 数据在父页获取一次，经 NuxtPage 传给各分区子页，切换分区不重复请求。
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

// 与外壳头部铃铛共享的未读数：菜单徽标与标记已读实时同步
const unreadCount = useState('shell-unread', () => 0);

// 左侧功能菜单：每个分区是独立子路由，URL 可深链、刷新保持当前分区
const menuItems = computed(() => [
    { to: '/profile', label: t('profile.tabOverview'), icon: 'view-dashboard-outline', exact: true, showUnread: false },
    { to: '/profile/preferences', label: t('profile.tabPreferences'), icon: 'cog-outline', exact: false, showUnread: false },
    { to: '/profile/orders', label: t('profile.tabOrders'), icon: 'receipt-text-outline', exact: false, showUnread: false },
    { to: '/profile/notifications', label: t('notifications.title'), icon: 'bell-outline', exact: false, showUnread: true },
]);

function isActive(item: { to: string; exact: boolean }) {
    return item.exact ? route.path === item.to : route.path.startsWith(item.to);
}

// 旧深链 ?section= 兼容：改写到对应子路由（/profile?section=notifications → /profile/notifications）
const legacySection = String(route.query.section ?? '');
if (legacySection) {
    const target = ['preferences', 'orders', 'notifications'].includes(legacySection) ? `/profile/${legacySection}` : '/profile';
    await navigateTo(target, { replace: true });
}

async function logout() {
    if (!confirm(t('profile.logoutConfirm'))) return;
    await authClient.signOut();
    await navigateTo('/login');
}
</script>

<template>
    <div class="mx-auto max-w-5xl space-y-7">
        <!-- 接口失败提示：不显示的话用户会把「加载失败」读成「没有数据/免费会员」 -->
        <div v-if="profileError" class="app-alert app-alert-danger flex items-center justify-between gap-3">
            <span>{{ profileError }}</span>
            <button type="button" class="app-btn app-btn-outline shrink-0 !py-1" @click="retryProfile">{{ t('common.retry') }}</button>
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
                <button class="app-btn app-btn-danger" @click="logout">{{ t('nav.logout') }}</button>
            </div>
        </div>

        <!-- 左右两栏：左侧功能菜单（子路由导航），右侧 NuxtPage 渲染对应分区 -->
        <div class="md:flex md:items-start md:gap-6">
            <!-- 功能菜单：桌面端左侧竖排并吸附；窄屏收成横向可滚动胶囊 -->
            <aside class="shrink-0 max-md:mb-4 md:sticky md:top-20 md:w-52">
                <nav class="app-panel p-1.5 md:p-2" :aria-label="t('profile.title')">
                    <div class="max-md:flex max-md:gap-1 max-md:overflow-x-auto md:space-y-1">
                        <NuxtLink
                            v-for="item in menuItems"
                            :key="item.to"
                            :to="item.to"
                            class="app-sidebar-link max-md:whitespace-nowrap"
                            :class="{ 'app-sidebar-link-active': isActive(item) }"
                            :aria-current="isActive(item) ? 'true' : undefined"
                        >
                            <AppIcon :name="item.icon" :size="17" />
                            <span>{{ item.label }}</span>
                            <span v-if="item.showUnread && unreadCount > 0" class="app-badge app-badge-danger ml-auto !px-1.5 !text-[10px] max-md:ml-1">
                                {{ unreadCount > 99 ? '99+' : unreadCount }}
                            </span>
                        </NuxtLink>
                    </div>
                </nav>
            </aside>

            <div class="min-w-0 flex-1">
                <NuxtPage :me="meData" :orders="ordersData" />
            </div>
        </div>
    </div>
</template>
