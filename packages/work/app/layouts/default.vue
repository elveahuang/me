<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * 工作台外壳。
 *
 * work 没有账号体系，因此头部不含登录态/用户菜单；只保留导航、外观与语言三件事。
 *
 * 响应式策略：
 * - < lg：主导航收进右侧抽屉，头部保留 外观/语言，汉堡按钮固定在最右端。
 * - ≥ lg：导航平铺在头部（纯文字），外观设置收进下拉，抽屉按钮隐藏。
 * - 汉堡按钮外层包 lg:hidden 容器而非在 .app-btn 上加变体：主题 CSS 未分层，
 *   .app-btn 的 display 会压掉 utilities 层的 lg:hidden（详见 AGENTS.md）。
 */
const { t, locale } = useI18n();
const { $setLocale } = useNuxtApp();
const siteTitle = useRuntimeConfig().public.siteSettings.siteTitle;

const route = useRoute();
const drawerOpen = ref(false);
const drawerRef = ref<HTMLElement | null>(null);

/** 主导航：首页即对话主体，用 Logo 表达；这里只放功能性入口（纯文字，无图标） */
const navLinks = computed(() => [
    { to: '/', label: t('nav.chat'), icon: 'chat-outline' },
    { to: '/chat', label: t('nav.agents'), icon: 'robot-outline' },
    { to: '/attachments', label: t('nav.attachments'), icon: 'file-document-outline' },
    { to: '/settings/agents', label: t('nav.systemSettings'), icon: 'cog-outline' },
]);

const primaryLinks = computed(() => navLinks.value.filter((link) => link.to !== '/'));

const otherLocaleLabel = computed(() => (locale.value === 'zh-CN' ? 'English' : '简体中文'));

function switchLocale(next: 'zh-CN' | 'en-US' = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN') {
    $setLocale(next);
}

/** 抽屉打开时把 Tab 焦点圈闭在抽屉内，避免焦点落到遮罩背后的页面内容 */
function trapDrawerFocus(event: KeyboardEvent) {
    const root = drawerRef.value;
    if (!root) return;
    const focusables = Array.from(
        root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, input, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null);
    const current = document.activeElement;
    if (focusables.length === 0 || !(current instanceof Node) || !root.contains(current)) {
        event.preventDefault();
        focusables[0]?.focus();
        return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
    }
}

/** 抽屉打开时锁定页面滚动，并把焦点移入抽屉（Esc 关闭，关闭后焦点回到汉堡按钮） */
function onKeydown(event: KeyboardEvent) {
    if (!drawerOpen.value) return;
    if (event.key === 'Escape') {
        drawerOpen.value = false;
        (document.getElementById('shell-drawer-trigger') as HTMLElement | null)?.focus();
        return;
    }
    if (event.key === 'Tab') {
        trapDrawerFocus(event);
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

// 窄屏打开抽屉后视口变宽过 lg：抽屉被 lg:hidden 藏起但滚动锁/Tab 圈闭仍在，自动关闭
useCloseDrawerOnWide(drawerOpen);

onBeforeUnmount(() => {
    if (import.meta.client) {
        document.body.style.overflow = '';
        document.removeEventListener('keydown', onKeydown);
    }
});

if (import.meta.client) {
    document.addEventListener('keydown', onKeydown);
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
                    <span class="app-avatar h-9 w-9 text-sm shadow-xs transition-transform group-hover:scale-105">W</span>
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
                        :aria-label="t('common.switchToLocale', { locale: otherLocaleLabel })"
                        @click="switchLocale()"
                    >
                        <AppIcon name="translate" :size="18" />
                    </button>

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
            <slot />
        </main>

        <footer class="app-divider" style="border-color: var(--line)">
            <div class="text-faint mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs sm:flex-row sm:px-6">
                <span>© {{ new Date().getFullYear() }} {{ siteTitle }}</span>
                <nav class="flex items-center gap-4">
                    <NuxtLink to="/chat" class="transition-colors hover:text-[color:var(--content-soft)]">{{ t('nav.agents') }}</NuxtLink>
                    <NuxtLink to="/" class="transition-colors hover:text-[color:var(--content-soft)]">{{ t('nav.chat') }}</NuxtLink>
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
                            <span class="app-avatar h-8 w-8 text-xs">W</span>
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
                        <nav class="space-y-1">
                            <p class="app-sidebar-group-title !px-2">{{ t('common.navigation') }}</p>
                            <NuxtLink v-for="link in navLinks" :key="link.to" :to="link.to" class="app-sidebar-link" active-class="app-sidebar-link-active">
                                <AppIcon :name="link.icon" :size="17" />
                                <span>{{ link.label }}</span>
                            </NuxtLink>
                        </nav>

                        <div class="app-divider" />

                        <div class="px-1">
                            <ThemeSwitcher variant="panel" />
                        </div>

                        <div class="app-divider" />

                        <!-- 抽屉是导航面板而非 role=menu，这里不能标 menuitem -->
                        <button type="button" class="app-dropdown-item" @click="switchLocale()">
                            <AppIcon name="translate" :size="17" />
                            <span>{{ otherLocaleLabel }}</span>
                        </button>
                    </div>
                </aside>
            </div>
        </Teleport>
    </div>
</template>
