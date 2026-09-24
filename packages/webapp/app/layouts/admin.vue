<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t, locale } = useI18n();
const { $setLocale } = useNuxtApp();
const route = useRoute();

const { session, load, signOut } = useSession();
const sidebarCollapsed = ref(false);
const mobileMenuOpen = ref(false);

const COLLAPSE_KEY = 'admin_sidebar_collapsed';
const OPEN_GROUPS_KEY = 'admin_sidebar_groups';

const mobileMenuRef = ref<HTMLElement | null>(null);
/** 移动端抽屉：Esc 关闭、焦点圈闭、滚动锁与焦点归还与 AdminDrawer 共用 useDrawerFocus */
useDrawerFocus(
    () => mobileMenuOpen.value,
    mobileMenuRef,
    () => {
        mobileMenuOpen.value = false;
    },
);

// 窄屏打开抽屉后视口变宽过 lg：抽屉被 lg:hidden 藏起但滚动锁仍在，自动关闭以释放
useCloseDrawerOnWide(mobileMenuOpen);

/** 展开的分组：默认只展开当前路由所属分组，其余收起以缩短首屏导航 */
const openGroups = ref<string[]>([]);

function groupKeyOfPath(path: string) {
    return navGroups.value.find((g) => g.items.some((it) => it.path === path))?.key ?? '';
}

function isGroupOpen(key: string) {
    return openGroups.value.includes(key);
}

function toggleGroup(key: string) {
    openGroups.value = isGroupOpen(key) ? openGroups.value.filter((g) => g !== key) : [...openGroups.value, key];
    persistGroups();
}

function persistGroups() {
    try {
        localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(openGroups.value));
    } catch {
        // 隐私模式或配额已满时只是丢失偏好，不影响导航
    }
}

function readStoredGroups(): string[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
    } catch {
        return [];
    }
}

onMounted(async () => {
    void load();
    try {
        sidebarCollapsed.value = localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
        // ignore
    }
    const active = groupKeyOfPath(route.path);
    openGroups.value = active ? [...new Set([...readStoredGroups(), active])] : readStoredGroups();
});

watch(
    () => route.path,
    (path) => {
        const active = groupKeyOfPath(path);
        if (active && !isGroupOpen(active)) {
            openGroups.value = [...openGroups.value, active];
            persistGroups();
        }
    },
);

function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
    try {
        localStorage.setItem(COLLAPSE_KEY, sidebarCollapsed.value ? '1' : '0');
    } catch {
        // ignore
    }
}

function toggleLanguage() {
    const next = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN';
    $setLocale(next);
}

/** 登出失败的就地提示：管理外壳跨路由存续，靠 showTransient 的超时自动清除避免横幅常驻 */
const { error: shellError, show: showShellError } = useTransientError();

async function handleLogout() {
    try {
        await signOut();
    } catch (e) {
        // 登出失败时保留本地会话并提示，不跳 /login，避免「退了还在线上」
        showShellError(extractApiError(e, t('common.error')));
        return;
    }
    navigateTo('/login');
}

// 导航菜单分组定义
const navGroups = computed(() => [
    {
        key: 'overview',
        title: t('nav.overview'),
        items: [{ path: '/admin', label: t('nav.dashboard'), icon: '📊' }],
    },
    {
        key: 'aiAssets',
        title: t('nav.aiAssets'),
        items: [
            { path: '/admin/agents', label: t('nav.agents'), icon: '🤖' },
            { path: '/admin/skills', label: t('nav.skills'), icon: '⚡' },
            { path: '/admin/tools', label: t('nav.tools'), icon: '🛠️' },
            { path: '/admin/providers', label: t('nav.providers'), icon: '🌐' },
            { path: '/admin/mcp', label: t('nav.mcp'), icon: '🔌' },
            { path: '/admin/knowledge', label: t('nav.knowledge'), icon: '📚' },
        ],
    },
    {
        key: 'content',
        title: t('nav.content'),
        items: [
            { path: '/admin/news', label: t('nav.news'), icon: '📰' },
            { path: '/admin/bulletins', label: t('nav.bulletins'), icon: '📣' },
            { path: '/admin/notifications', label: t('nav.notifications'), icon: '🔔' },
        ],
    },
    {
        key: 'operations',
        title: t('nav.operations'),
        items: [
            { path: '/admin/conversations', label: t('nav.conversations'), icon: '💬' },
            { path: '/admin/plans', label: t('nav.plans'), icon: '💳' },
            { path: '/admin/orders', label: t('nav.orders'), icon: '🧾' },
            { path: '/admin/users', label: t('nav.users'), icon: '👥' },
            { path: '/admin/attachments', label: t('nav.attachments'), icon: '📎' },
        ],
    },
    {
        key: 'system',
        title: t('nav.systemSettings'),
        items: [{ path: '/admin/settings', label: t('nav.systemSettings'), icon: '⚙️' }],
    },
]);

// 计算当前页面名称
const currentRouteName = computed(() => {
    for (const group of navGroups.value) {
        const found = group.items.find((it) => it.path === route.path);
        if (found) return found.label;
    }
    return t('nav.admin');
});
</script>

<template>
    <div class="bg-surface-2 text-strong flex min-h-screen flex-col antialiased">
        <!-- 1. 上面导航 (Top Navbar) -->
        <header class="border-line bg-surface text-strong sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b px-4 sm:px-6">
            <!-- 左侧：品牌 Logo + 菜单展开/收起 + 面包屑 -->
            <div class="flex items-center gap-3 sm:gap-4">
                <button
                    type="button"
                    class="border-line text-soft text-hover-strong flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-[color:var(--surface-3)] lg:hidden"
                    :aria-label="t('nav.menu')"
                    @click="mobileMenuOpen = !mobileMenuOpen"
                >
                    <span class="text-base">☰</span>
                </button>
                <button
                    type="button"
                    class="border-line text-soft text-hover-strong hidden h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-[color:var(--surface-3)] lg:flex"
                    :title="t('nav.toggleSidebar')"
                    @click="toggleSidebar"
                >
                    <span class="text-sm">⇄</span>
                </button>

                <!-- 品牌标识 -->
                <NuxtLink to="/admin" class="flex items-center gap-2.5">
                    <div class="bg-brand-gradient flex h-8 w-8 items-center justify-center rounded-xl text-sm font-black">ME</div>
                    <span class="text-strong hidden text-base font-black tracking-tight sm:inline-block">
                        {{ t('common.adminAppName') }}
                    </span>
                </NuxtLink>

                <!-- 面包屑分隔符与当前定位 -->
                <div class="border-line text-faint hidden items-center gap-2 border-l pl-3 text-xs md:flex">
                    <NuxtLink to="/admin" class="app-link">{{ t('nav.admin') }}</NuxtLink>
                    <span>/</span>
                    <span class="text-strong font-semibold">{{ currentRouteName }}</span>
                </div>
            </div>

            <!-- 右侧：全局语言切换 + 返回用户端 + 用户身份 -->
            <div class="flex items-center gap-2.5 sm:gap-3">
                <!-- 多语言切换胶囊按钮 -->
                <button type="button" class="app-btn app-btn-outline app-btn-sm" :title="t('profile.languageSelect')" @click="toggleLanguage">
                    <span>🌐</span>
                    <span>{{ locale === 'zh-CN' ? 'EN' : '中文' }}</span>
                </button>

                <!-- 返回前台快捷入口 -->
                <NuxtLink to="/" class="app-btn app-btn-soft app-btn-sm">
                    <span>←</span>
                    <span class="hidden sm:inline">{{ t('nav.backToApp') }}</span>
                    <span class="sm:hidden">{{ t('nav.chat') }}</span>
                </NuxtLink>

                <!-- 管理员身份徽章 -->
                <div v-if="session" class="border-line flex items-center gap-2 border-l pl-2">
                    <div class="bg-brand flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold">
                        {{ session.user.name?.[0]?.toUpperCase() || 'A' }}
                    </div>
                    <div class="hidden text-left lg:block">
                        <p class="text-strong max-w-[100px] truncate text-xs leading-tight font-bold">{{ session.user.name }}</p>
                        <span class="text-brand text-[10px] font-semibold tracking-wider uppercase">Admin</span>
                    </div>
                    <button
                        type="button"
                        class="text-faint text-hover-danger ml-1 p-1 text-xs transition-colors"
                        :title="t('nav.logout')"
                        @click="handleLogout"
                    >
                        ⏻
                    </button>
                </div>
            </div>
        </header>

        <!-- 中部主体：左边菜单 + 右边主题内容 -->
        <div class="flex flex-1 overflow-hidden">
            <!-- 2. 左边菜单 (Left Sidebar) - 桌面端 -->
            <aside
                :class="['border-line bg-surface hidden flex-col border-r transition-all duration-200 select-none lg:flex', sidebarCollapsed ? 'w-16' : 'w-60']"
            >
                <div class="flex-1 space-y-3 overflow-y-auto px-3 py-4">
                    <div v-for="group in navGroups" :key="group.key" class="space-y-1">
                        <!-- 展开态下分组标题即折叠开关；图标模式空间足够，全量平铺不再折叠 -->
                        <button
                            v-if="!sidebarCollapsed"
                            type="button"
                            class="text-faint text-hover-muted flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase transition-colors hover:bg-[color:var(--surface-3)]"
                            :aria-expanded="isGroupOpen(group.key)"
                            @click="toggleGroup(group.key)"
                        >
                            <span>{{ group.title }}</span>
                            <span class="text-[9px] transition-transform duration-200" :class="isGroupOpen(group.key) ? 'rotate-90' : ''">▸</span>
                        </button>
                        <p v-else class="bg-surface-3 mx-2 my-2 h-px"></p>

                        <NuxtLink
                            v-for="item in sidebarCollapsed || isGroupOpen(group.key) ? group.items : []"
                            :key="item.path"
                            :to="item.path"
                            class="app-sidebar-link"
                            exact-active-class="app-sidebar-link-active"
                            :class="[sidebarCollapsed ? 'justify-center !px-0' : '']"
                            :title="sidebarCollapsed ? item.label : undefined"
                        >
                            <span class="text-base leading-none">{{ item.icon }}</span>
                            <span v-if="!sidebarCollapsed" class="truncate">{{ item.label }}</span>
                        </NuxtLink>
                    </div>
                </div>

                <!-- 侧边栏底部简要状态 -->
                <div v-if="!sidebarCollapsed" class="border-line bg-surface-2 text-faint border-t p-3 text-center text-[11px]">ME Platform v26.3 · Admin</div>
            </aside>

            <!-- 移动端侧边抽屉菜单 -->
            <template v-if="mobileMenuOpen">
                <div class="app-drawer-backdrop lg:hidden" @click="mobileMenuOpen = false"></div>
                <div ref="mobileMenuRef" class="app-drawer app-drawer-left lg:hidden" role="dialog" aria-modal="true" :aria-label="t('common.adminAppName')">
                    <div class="app-divider flex items-center justify-between px-4 py-3.5">
                        <span class="text-strong text-sm font-bold">{{ t('common.adminAppName') }}</span>
                        <button type="button" class="text-faint text-hover-strong p-1" :aria-label="t('common.close')" @click="mobileMenuOpen = false">
                            ✕
                        </button>
                    </div>
                    <div class="app-drawer-body !px-2 !py-2">
                        <div v-for="group in navGroups" :key="group.key" class="mb-3 space-y-0.5">
                            <p class="app-sidebar-group-title !px-3 !pb-1">{{ group.title }}</p>
                            <NuxtLink
                                v-for="item in group.items"
                                :key="item.path"
                                :to="item.path"
                                class="app-sidebar-link"
                                exact-active-class="app-sidebar-link-active"
                                @click="mobileMenuOpen = false"
                            >
                                <span>{{ item.icon }}</span>
                                <span>{{ item.label }}</span>
                            </NuxtLink>
                        </div>
                    </div>
                </div>
            </template>

            <!-- 3. 右边主题内容 (Right Main Content) -->
            <main class="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                <div class="mx-auto max-w-7xl">
                    <div v-if="shellError" class="app-alert app-alert-danger mb-4">{{ shellError }}</div>
                    <slot />
                </div>
            </main>
        </div>
    </div>
</template>
