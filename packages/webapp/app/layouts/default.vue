<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * 用户端外壳。
 *
 * 响应式策略：
 * - < lg：主导航收进右侧抽屉，头部保留 消息/语言/用户菜单，汉堡按钮固定在最右端。
 * - ≥ lg：导航平铺在头部（纯文字），外观设置收进下拉，抽屉按钮隐藏。
 * - 汉堡按钮外层包 lg:hidden 容器而非在 .app-btn 上加变体：主题 CSS 未分层，
 *   .app-btn 的 display 会压掉 utilities 层的 lg:hidden（详见 AGENTS.md）。
 */
const { t, locale } = useI18n();
const { $setLocale } = useNuxtApp();
const { session, load } = useSession();
const siteTitle = useRuntimeConfig().public.siteSettings.siteTitle;

const route = useRoute();
const drawerOpen = ref(false);
const drawerRef = ref<HTMLElement | null>(null);

/**
 * 未读消息角标。登录态就绪后取一次，客户端每 60 秒刷新。
 * shell-unread 是共享状态：个人中心的消息通知分区标记已读后同步更新此值。
 * 未登录或接口不可用时静默保持 0，不影响外壳可用性。
 */
const unreadCount = useState('shell-unread', () => 0);

async function refreshUnread() {
    if (!session.value) {
        unreadCount.value = 0;
        return;
    }
    try {
        const res = await $fetch<{ unread: number }>('/api/notifications/unread');
        unreadCount.value = res.unread ?? 0;
    } catch {
        // 角标属于辅助信息，失败时不打扰用户
    }
}

let unreadTimer: ReturnType<typeof setInterval> | null = null;

/**
 * useAsyncData（不加 await）：SSR 渲染器会等待其 resolve，因此首屏就是正确的登录态，
 * 不会先渲染「登录/注册」再闪成用户名；客户端则复用同一份 payload，不重复请求。
 */
useAsyncData('shell-session', () => load(), { server: true });

const navLinks = computed(() => [
    { to: '/', label: t('nav.home'), icon: 'dots-grid' },
    { to: '/chat', label: t('nav.chat'), icon: 'chat-outline' },
    { to: '/news', label: t('nav.news'), icon: 'newspaper-variant-outline' },
    { to: '/pricing', label: t('nav.pricing'), icon: 'crown-outline' },
]);

/** 头部主导航：首页在外壳里用 Logo 表达，这里只放功能性入口（纯文字，无图标） */
const primaryLinks = computed(() => navLinks.value.filter((link) => link.to !== '/'));

const otherLocale = computed(() => (locale.value === 'zh-CN' ? 'en-US' : 'zh-CN'));
const otherLocaleLabel = computed(() => (locale.value === 'zh-CN' ? 'English' : '简体中文'));

function switchLocale(next: 'zh-CN' | 'en-US' = otherLocale.value) {
    $setLocale(next);
}

/** 抽屉打开时锁定页面滚动，并把焦点移入抽屉（Esc 关闭，关闭后焦点回到汉堡按钮） */
function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && drawerOpen.value) {
        drawerOpen.value = false;
        (document.getElementById('shell-drawer-trigger') as HTMLElement | null)?.focus();
    }
}

watch(drawerOpen, async (open) => {
    if (!import.meta.client) return;
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
        await nextTick();
        drawerRef.value?.querySelector<HTMLElement>('[data-drawer-close]')?.focus();
    }
});

watch(
    () => route.fullPath,
    () => (drawerOpen.value = false),
);

// 进入个人中心即刷新角标（消息通知分区在其中，标记已读后由共享状态同步）
watch(
    () => route.path,
    (path) => {
        if (path === '/profile') void refreshUnread();
    },
);

onMounted(() => {
    void refreshUnread();
    unreadTimer = setInterval(() => void refreshUnread(), 60_000);
});

onBeforeUnmount(() => {
    if (import.meta.client) {
        document.body.style.overflow = '';
        document.removeEventListener('keydown', onKeydown);
    }
    if (unreadTimer) clearInterval(unreadTimer);
});

if (import.meta.client) {
    document.addEventListener('keydown', onKeydown);
}

async function logout() {
    const { signOut } = useSession();
    await signOut();
    await navigateTo('/login');
}
</script>

<template>
    <div class="bg-surface-2 text-strong flex min-h-screen flex-col antialiased">
        <a href="#main" class="app-skip-link">{{ t('common.skipToContent') }}</a>

        <header
            class="sticky top-0 z-30 border-b backdrop-blur-md"
            style="border-color: var(--line); background-color: color-mix(in oklab, var(--surface) 85%, transparent)"
        >
            <div class="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6">
                <NuxtLink to="/" class="group flex shrink-0 items-center gap-2.5">
                    <span class="app-avatar h-9 w-9 text-sm shadow-xs transition-transform group-hover:scale-105">ME</span>
                    <span class="text-brand hidden text-lg font-black tracking-tight sm:inline">{{ siteTitle }}</span>
                </NuxtLink>

                <!-- 桌面端主导航（纯文字） -->
                <nav class="ml-4 hidden items-center gap-1 lg:flex">
                    <NuxtLink
                        v-for="link in primaryLinks"
                        :key="link.to"
                        :to="link.to"
                        class="app-nav-link inline-flex items-center"
                        active-class="app-nav-link-active"
                    >
                        <span>{{ link.label }}</span>
                    </NuxtLink>
                </nav>

                <div class="ml-auto flex items-center gap-1.5">
                    <!-- 消息入口（带未读角标），直达个人中心的消息通知分区 -->
                    <NuxtLink
                        v-if="session"
                        to="/profile/notifications"
                        class="app-btn app-btn-ghost app-btn-icon relative"
                        :title="t('notifications.title')"
                        :aria-label="t('notifications.title')"
                    >
                        <AppIcon name="bell-outline" :size="18" />
                        <span
                            v-if="unreadCount"
                            class="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--danger)] px-1 text-[9px] font-bold text-white"
                        >
                            {{ unreadCount > 99 ? '99+' : unreadCount }}
                        </span>
                    </NuxtLink>

                    <!-- 外观设置：桌面端收进下拉，避免头部堆一排主题按钮 -->
                    <AppDropdown class="hidden lg:block" align="right" width="18rem">
                        <template #trigger="{ toggle, attrs }">
                            <button v-bind="attrs" type="button" class="app-btn app-btn-ghost app-btn-icon" :title="t('common.theme')" @click="toggle">
                                <AppIcon name="theme-light-dark" :size="18" />
                            </button>
                        </template>
                        <template #default>
                            <div class="p-1.5">
                                <ThemeSwitcher variant="panel" />
                            </div>
                        </template>
                    </AppDropdown>

                    <!-- 语言切换 -->
                    <button
                        type="button"
                        class="app-btn app-btn-ghost app-btn-icon"
                        :title="t('profile.languageSelect')"
                        :aria-label="`切换到 ${otherLocaleLabel}`"
                        @click="switchLocale()"
                    >
                        <AppIcon name="translate" :size="18" />
                    </button>

                    <UserMenu />

                    <template v-if="!session">
                        <NuxtLink to="/login" class="app-nav-link hidden sm:inline-flex">{{ t('nav.login') }}</NuxtLink>
                        <NuxtLink to="/register" class="app-btn app-btn-primary">{{ t('nav.register') }}</NuxtLink>
                    </template>

                    <!-- 移动端汉堡菜单：固定在头部最右端；外层 lg:hidden 容器负责桌面端隐藏 -->
                    <div class="lg:hidden">
                        <button
                            id="shell-drawer-trigger"
                            type="button"
                            class="app-btn app-btn-ghost app-btn-icon"
                            :aria-label="t('common.openMenu')"
                            aria-controls="shell-drawer"
                            :aria-expanded="drawerOpen"
                            @click="drawerOpen = true"
                        >
                            <AppIcon name="menu" :size="20" />
                        </button>
                    </div>
                </div>
            </div>
        </header>

        <main id="main" class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
            <!-- 全站宣传栏：位置选「全站」的内容在每个页面出现（组件自身在无内容时不渲染） -->
            <div class="mb-4">
                <BulletinBanner position="global" />
            </div>
            <slot />
        </main>

        <footer class="app-divider" style="border-color: var(--line)">
            <div class="text-faint mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs sm:flex-row sm:px-6">
                <span>© {{ new Date().getFullYear() }} {{ t('common.appName') }}</span>
                <nav class="flex items-center gap-4">
                    <NuxtLink to="/pricing" class="transition-colors hover:text-[color:var(--content-soft)]">{{ t('nav.pricing') }}</NuxtLink>
                    <NuxtLink to="/chat" class="transition-colors hover:text-[color:var(--content-soft)]">{{ t('nav.chat') }}</NuxtLink>
                    <a
                        href="/api/health"
                        target="_blank"
                        rel="noopener"
                        class="inline-flex items-center gap-1 transition-colors hover:text-[color:var(--content-soft)]"
                    >
                        <span>{{ t('common.systemStatus') }}</span>
                        <AppIcon name="external-link" :size="13" />
                    </a>
                </nav>
            </div>
        </footer>

        <!--
            移动端导航抽屉。遮罩与抽屉的入场动画写在 CSS 里（.app-drawer-backdrop / .app-drawer-left），
            不用 <Transition> 包裹：外层容器一旦拿到 transform 就会成为 fixed 子元素的包含块，
            而该容器自身高度为 0，会把抽屉压成 0 高度。
        -->
        <Teleport to="body">
            <div v-if="drawerOpen" class="lg:hidden">
                <div class="app-drawer-backdrop" @click="drawerOpen = false" />
                <aside
                    id="shell-drawer"
                    ref="drawerRef"
                    class="app-drawer app-drawer-right safe-top safe-bottom"
                    role="dialog"
                    aria-modal="true"
                    :aria-label="t('common.navigation')"
                >
                    <div class="flex items-center justify-between border-b px-4 py-3" style="border-color: var(--line)">
                        <span class="flex items-center gap-2.5">
                            <span class="app-avatar h-8 w-8 text-xs">ME</span>
                            <span class="text-sm font-black">{{ siteTitle }}</span>
                        </span>
                        <button
                            type="button"
                            data-drawer-close
                            class="app-btn app-btn-ghost app-btn-icon"
                            :aria-label="t('common.close')"
                            @click="drawerOpen = false"
                        >
                            <AppIcon name="close" :size="18" />
                        </button>
                    </div>

                    <div class="app-drawer-body space-y-4">
                        <!-- 登录态摘要 -->
                        <div v-if="session" class="app-panel flex items-center gap-3 p-3">
                            <span class="app-avatar h-10 w-10 text-sm">{{ session.user.name?.[0]?.toUpperCase() || 'U' }}</span>
                            <div class="min-w-0">
                                <p class="truncate text-xs font-bold">{{ session.user.name }}</p>
                                <p class="text-faint truncate text-[11px]">{{ session.user.email }}</p>
                            </div>
                        </div>

                        <nav class="space-y-1">
                            <p class="app-sidebar-group-title !px-2">{{ t('common.navigation') }}</p>
                            <NuxtLink v-for="link in navLinks" :key="link.to" :to="link.to" class="app-sidebar-link" active-class="app-sidebar-link-active">
                                <AppIcon :name="link.icon" :size="17" />
                                <span>{{ link.label }}</span>
                            </NuxtLink>
                            <NuxtLink v-if="session" to="/profile" class="app-sidebar-link" active-class="app-sidebar-link-active">
                                <AppIcon name="account-outline" :size="17" />
                                <span>{{ t('nav.profile') }}</span>
                            </NuxtLink>
                        </nav>

                        <div class="app-divider" />

                        <div class="px-1">
                            <ThemeSwitcher variant="panel" />
                        </div>

                        <div class="app-divider" />

                        <button type="button" class="app-dropdown-item" @click="switchLocale()">
                            <AppIcon name="translate" :size="17" />
                            <span>{{ otherLocaleLabel }}</span>
                        </button>

                        <button v-if="session" type="button" class="app-dropdown-item app-dropdown-item-danger" @click="logout">
                            <AppIcon name="logout-variant" :size="17" />
                            <span>{{ t('nav.logout') }}</span>
                        </button>
                        <div v-else class="app-page-actions">
                            <NuxtLink to="/login" class="app-btn app-btn-outline flex-1">{{ t('nav.login') }}</NuxtLink>
                            <NuxtLink to="/register" class="app-btn app-btn-primary flex-1">{{ t('nav.register') }}</NuxtLink>
                        </div>
                    </div>
                </aside>
            </div>
        </Teleport>
    </div>
</template>
