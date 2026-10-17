<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { WORK_SETTINGS_PAGES } from '../utils/work-settings';

/**
 * 设置区独立布局：左侧设置导航 + 左上返回工作台。
 *
 * 设置不再复用工作台三段侧栏；工作台的空间、最近对话、新建对话都不出现在这里。
 * 桌面固定左栏，窄屏收成左侧抽屉；页面内容居中，整体更接近 Codex 的设置页布局。
 */
const { t } = useI18n();
const route = useRoute();
const siteTitle = useSiteTitle();

const drawerOpen = ref(false);
const drawerRef = ref<HTMLElement | null>(null);
useDrawerFocus(() => drawerOpen.value, drawerRef, () => (drawerOpen.value = false));
useCloseDrawerOnWide(drawerOpen);
watch(() => route.fullPath, () => (drawerOpen.value = false));

const groups = computed(() => {
    const defs = [
        { key: 'workspace', label: t('settings.groupWorkspace') },
        { key: 'capabilities', label: t('settings.groupCapabilities') },
        { key: 'data', label: t('settings.groupData') },
    ] as const;
    return defs.map((group) => ({
        ...group,
        items: WORK_SETTINGS_PAGES.filter((page) => page.groupKey === group.key),
    }));
});

function isActive(to: string) {
    const path = route.path;
    return to === '/settings' ? path === '/settings' : path === to || path.startsWith(`${to}/`);
}
</script>

<template>
    <div class="bg-surface-2 text-strong min-h-dvh antialiased">
        <a href="#main" class="app-skip-link">{{ t('common.skipToContent') }}</a>

        <aside class="border-line bg-surface fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r lg:flex" :aria-label="t('settings.navTitle')">
            <div class="shrink-0 px-3 pt-3">
                <NuxtLink to="/" class="app-btn app-btn-primary app-btn-block gap-1.5 !text-xs">
                    <AppIcon name="arrow-left" :size="15" />
                    <span>{{ t('settings.backToWorkbench') }}</span>
                </NuxtLink>
            </div>

            <div class="border-line flex shrink-0 items-center gap-2.5 border-b px-4 py-4">
                <span class="app-avatar h-9 w-9 text-sm shadow-xs">W</span>
                <div class="min-w-0">
                    <p class="text-brand truncate text-base font-black tracking-tight">{{ siteTitle }}</p>
                    <p class="text-faint text-[10px]">{{ t('nav.systemSettings') }}</p>
                </div>
            </div>

            <nav class="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                <div v-for="group in groups" :key="group.key" class="mb-5 last:mb-0">
                    <p class="text-faint px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wide">{{ group.label }}</p>
                    <NuxtLink
                        v-for="item in group.items"
                        :key="item.to"
                        :to="item.to"
                        class="app-sidebar-link"
                        :class="isActive(item.to) ? 'app-sidebar-link-active' : ''"
                        :aria-current="isActive(item.to) ? 'page' : undefined"
                    >
                        <AppIcon :name="item.icon" :size="17" />
                        <span class="truncate">{{ t(item.labelKey) }}</span>
                    </NuxtLink>
                </div>
            </nav>
        </aside>

        <header class="border-line bg-surface sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 lg:hidden">
            <NuxtLink to="/" class="app-btn app-btn-ghost app-btn-icon" :aria-label="t('settings.backToWorkbench')" :title="t('settings.backToWorkbench')">
                <AppIcon name="arrow-left" :size="19" />
            </NuxtLink>
            <span class="text-brand truncate text-base font-black">{{ t('nav.systemSettings') }}</span>
            <button
                type="button"
                class="app-btn app-btn-ghost app-btn-icon ml-auto"
                :aria-label="t('common.openMenu')"
                :aria-expanded="drawerOpen"
                @click="drawerOpen = true"
            >
                <AppIcon name="menu" :size="19" />
            </button>
        </header>

        <div class="lg:pl-64">
            <main id="main" class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
                <slot />
            </main>
        </div>

        <Teleport to="body">
            <div v-if="drawerOpen" class="app-modal-backdrop lg:hidden" @click.self="drawerOpen = false">
                <aside
                    ref="drawerRef"
                    class="app-drawer app-drawer-left safe-top safe-bottom"
                    role="dialog"
                    aria-modal="true"
                    :aria-label="t('settings.navTitle')"
                >
                    <div class="border-line flex shrink-0 items-center justify-between border-b px-4 py-3">
                        <NuxtLink to="/" class="app-btn app-btn-primary app-btn-sm gap-1.5" @click="drawerOpen = false">
                            <AppIcon name="arrow-left" :size="15" />
                            <span>{{ t('settings.backToWorkbench') }}</span>
                        </NuxtLink>
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
                    <div class="app-drawer-body flex min-h-0 flex-1 flex-col !p-3">
                        <nav class="min-h-0 flex-1 overflow-y-auto" :aria-label="t('settings.navTitle')">
                            <div v-for="group in groups" :key="group.key" class="mb-5 last:mb-0">
                                <p class="text-faint px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wide">{{ group.label }}</p>
                                <NuxtLink
                                    v-for="item in group.items"
                                    :key="item.to"
                                    :to="item.to"
                                    class="app-sidebar-link"
                                    :class="isActive(item.to) ? 'app-sidebar-link-active' : ''"
                                    :aria-current="isActive(item.to) ? 'page' : undefined"
                                >
                                    <AppIcon :name="item.icon" :size="17" />
                                    <span class="truncate">{{ t(item.labelKey) }}</span>
                                </NuxtLink>
                            </div>
                        </nav>
                    </div>
                </aside>
            </div>
        </Teleport>
    </div>
</template>
