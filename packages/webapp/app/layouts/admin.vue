<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { authClient, fetchSession } from '~/utils/auth-client';

const { t, locale } = useI18n();
const { $setLocale } = useNuxtApp();
const route = useRoute();

const session = ref<{ user: { id: string; name: string; email: string; role: string } } | null>(null);
const sidebarCollapsed = ref(false);
const mobileMenuOpen = ref(false);

const COLLAPSE_KEY = 'admin_sidebar_collapsed';
const OPEN_GROUPS_KEY = 'admin_sidebar_groups';

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
    session.value = (await fetchSession()) as any;
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

async function handleLogout() {
    await authClient.signOut();
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
    <div class="flex min-h-screen flex-col bg-slate-50 text-slate-800 antialiased">
        <!-- 1. 上面导航 (Top Navbar) -->
        <header class="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md sm:px-6">
            <!-- 左侧：品牌 Logo + 菜单展开/收起 + 面包屑 -->
            <div class="flex items-center gap-3 sm:gap-4">
                <button
                    type="button"
                    class="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden"
                    @click="mobileMenuOpen = !mobileMenuOpen"
                >
                    <span class="text-base">☰</span>
                </button>
                <button
                    type="button"
                    class="hidden h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:flex"
                    :title="t('nav.toggleSidebar')"
                    @click="toggleSidebar"
                >
                    <span class="text-sm">⇄</span>
                </button>

                <!-- 品牌标识 -->
                <NuxtLink to="/admin" class="flex items-center gap-2.5">
                    <div
                        class="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-sm font-black text-white shadow-xs"
                    >
                        ME
                    </div>
                    <span
                        class="hidden bg-gradient-to-r from-emerald-700 to-teal-800 bg-clip-text text-base font-black tracking-tight text-transparent sm:inline-block"
                    >
                        {{ t('common.adminAppName') }}
                    </span>
                </NuxtLink>

                <!-- 面包屑分隔符与当前定位 -->
                <div class="hidden items-center gap-2 border-l border-slate-200 pl-3 text-xs text-slate-400 md:flex">
                    <NuxtLink to="/admin" class="transition-colors hover:text-slate-600">{{ t('nav.admin') }}</NuxtLink>
                    <span>/</span>
                    <span class="font-semibold text-slate-700">{{ currentRouteName }}</span>
                </div>
            </div>

            <!-- 右侧：全局语言切换 + 返回用户端 + 用户身份 -->
            <div class="flex items-center gap-2.5 sm:gap-3">
                <!-- 多语言切换胶囊按钮 -->
                <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
                    :title="t('profile.languageSelect')"
                    @click="toggleLanguage"
                >
                    <span>🌐</span>
                    <span>{{ locale === 'zh-CN' ? 'EN' : '中文' }}</span>
                </button>

                <!-- 返回前台快捷入口 -->
                <NuxtLink
                    to="/chat"
                    class="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100/70"
                >
                    <span>←</span>
                    <span class="hidden sm:inline">{{ t('nav.backToApp') }}</span>
                    <span class="sm:hidden">{{ t('nav.chat') }}</span>
                </NuxtLink>

                <!-- 管理员身份徽章 -->
                <div v-if="session" class="flex items-center gap-2 border-l border-slate-200 pl-2">
                    <div class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white shadow-2xs">
                        {{ session.user.name?.[0]?.toUpperCase() || 'A' }}
                    </div>
                    <div class="hidden text-left lg:block">
                        <p class="max-w-[100px] truncate text-xs leading-tight font-bold text-slate-800">{{ session.user.name }}</p>
                        <span class="text-[10px] font-semibold tracking-wider text-emerald-600 uppercase">Admin</span>
                    </div>
                    <button
                        type="button"
                        class="ml-1 p-1 text-xs text-slate-400 transition-colors hover:text-red-500"
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
                :class="[
                    'hidden flex-col border-r border-slate-200/80 bg-white transition-all duration-200 select-none lg:flex',
                    sidebarCollapsed ? 'w-16' : 'w-60',
                ]"
            >
                <div class="flex-1 space-y-3 overflow-y-auto px-3 py-4">
                    <div v-for="group in navGroups" :key="group.key" class="space-y-1">
                        <!-- 展开态下分组标题即折叠开关；图标模式空间足够，全量平铺不再折叠 -->
                        <button
                            v-if="!sidebarCollapsed"
                            type="button"
                            class="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase transition-colors hover:bg-slate-50 hover:text-slate-600"
                            :aria-expanded="isGroupOpen(group.key)"
                            @click="toggleGroup(group.key)"
                        >
                            <span>{{ group.title }}</span>
                            <span class="text-[9px] transition-transform duration-200" :class="isGroupOpen(group.key) ? 'rotate-90' : ''">▸</span>
                        </button>
                        <p v-else class="mx-2 my-2 h-px bg-slate-100"></p>

                        <NuxtLink
                            v-for="item in sidebarCollapsed || isGroupOpen(group.key) ? group.items : []"
                            :key="item.path"
                            :to="item.path"
                            exact-active-class="bg-emerald-50 text-emerald-700 font-semibold shadow-2xs border-r-2 border-emerald-600"
                            :class="[
                                'group flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900',
                                sidebarCollapsed ? 'justify-center px-0' : '',
                            ]"
                            :title="sidebarCollapsed ? item.label : undefined"
                        >
                            <span class="text-base leading-none transition-transform group-hover:scale-110">{{ item.icon }}</span>
                            <span v-if="!sidebarCollapsed" class="truncate">{{ item.label }}</span>
                        </NuxtLink>
                    </div>
                </div>

                <!-- 侧边栏底部简要状态 -->
                <div v-if="!sidebarCollapsed" class="border-t border-slate-100 bg-slate-50/50 p-3 text-center text-[11px] text-slate-400">
                    ME Platform v26.3 · Admin
                </div>
            </aside>

            <!-- 移动端侧边抽屉菜单 -->
            <div v-if="mobileMenuOpen" class="fixed inset-0 z-40 flex lg:hidden" @click.self="mobileMenuOpen = false">
                <div class="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"></div>
                <div class="relative z-50 flex w-72 flex-col bg-white p-4 shadow-xl">
                    <div class="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                        <span class="text-sm font-bold text-slate-800">{{ t('common.adminAppName') }}</span>
                        <button class="text-slate-400 hover:text-slate-700" @click="mobileMenuOpen = false">✕</button>
                    </div>
                    <div class="flex-1 space-y-4 overflow-y-auto">
                        <div v-for="(group, gIdx) in navGroups" :key="gIdx" class="space-y-1">
                            <p class="px-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase">{{ group.title }}</p>
                            <NuxtLink
                                v-for="item in group.items"
                                :key="item.path"
                                :to="item.path"
                                exact-active-class="bg-emerald-50 text-emerald-700 font-semibold"
                                class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                                @click="mobileMenuOpen = false"
                            >
                                <span>{{ item.icon }}</span>
                                <span>{{ item.label }}</span>
                            </NuxtLink>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 3. 右边主题内容 (Right Main Content) -->
            <main class="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                <div class="mx-auto max-w-7xl">
                    <slot />
                </div>
            </main>
        </div>
    </div>
</template>
