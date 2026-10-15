<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * 工作台外壳（主流 AI 工作台布局：固定左栏 + 无顶部导航）。
 *
 * 左栏自上而下三段：功能导航 / 会话列表（新建对话 + 对话记录）/ 设置（外观、语言、版权）。
 *
 * - ≥ lg：固定左侧栏占满高度；主内容区 `lg:pl-64`，没有顶部导航栏与页脚。
 * - < lg：左栏收成左侧抽屉，只留一条极窄顶栏（汉堡 + Logo）作为抽屉入口。
 * - 会话列表与选中态由 `useChatSidebar` 提供：布局拉数据、渲染左栏，聊天页只消费，
 *   避免侧栏与页面各拉一份、选中态分叉。
 * - 主题 CSS 未分层：.app-btn 的 display 会压掉 utilities 层的响应式隐藏，
 *   所以顶栏上的汉堡按钮必须包在外层 lg:hidden 容器里（顶栏自身已是 lg:hidden）。
 * - 抽屉是导航面板（不是 role=menu），布局内的 Tab 圈闭/滚动锁是唯一实现，勿另造。
 */
const { t, locale } = useI18n();
const { $setLocale } = useNuxtApp();
const siteTitle = useRuntimeConfig().public.siteSettings.siteTitle;

const route = useRoute();
/** 抽屉开关：布局持有，ChatPane 头部的历史按钮（窄屏）也开同一个抽屉 */
const { open: drawerOpen } = useShellDrawer();
const drawerRef = ref<HTMLElement | null>(null);
/** 命令面板只暴露 openPalette()/close()，布局不持有它的开关状态 */
const palette = ref<{ openPalette: () => void } | null>(null);

/** 会话列表与选中态：左栏渲染，聊天页消费 */
const {
    visibleConversations,
    activeConversationId,
    agentIdParam,
    conversationsPending,
    conversationsError,
    refreshConversations,
    effectiveConversationId,
    selectConversation,
    startNewChat,
} = useChatSidebar();

const conversationError = computed(() => (conversationsError.value ? t('common.loadFailed') : ''));

/**
 * 侧栏分组导航（Linear / Notion 的写法：条目多了靠分组标题保持可扫读）。
 *
 * `match` 决定高亮前缀（'/' 必须精确匹配，否则包含式匹配会命中所有路由）。
 * 桌面端与抽屉共用同一个 computed，两侧不会因某次只改一处而菜单项分叉。
 */
const navGroups = computed(() => [
    {
        title: t('nav.groupWork'),
        links: [
            { to: '/today', label: t('nav.today'), icon: 'view-dashboard-outline', match: '/today' },
            { to: '/tasks', label: t('nav.tasks'), icon: 'check-all', match: '/tasks' },
            { to: '/calendar', label: t('nav.calendar'), icon: 'calendar-check-outline', match: '/calendar' },
            { to: '/notes', label: t('nav.notes'), icon: 'book-open-page-variant-outline', match: '/notes' },
            { to: '/projects', label: t('nav.projects'), icon: 'folder-outline', match: '/projects' },
        ],
    },
    {
        title: t('nav.groupAi'),
        links: [
            { to: '/', label: t('nav.chat'), icon: 'chat-outline', match: '/' },
            { to: '/chat', label: t('nav.agents'), icon: 'robot-outline', match: '/chat' },
            { to: '/attachments', label: t('nav.attachments'), icon: 'file-document-outline', match: '/attachments' },
            { to: '/settings/agents', label: t('nav.systemSettings'), icon: 'cog-outline', match: '/settings' },
        ],
    },
]);

function isNavActive(match: string) {
    const path = route.path;
    return match === '/' ? path === '/' : path === match || path.startsWith(`${match}/`);
}

const otherLocaleLabel = computed(() => (locale.value === 'zh-CN' ? 'English' : '简体中文'));

function switchLocale(next: 'zh-CN' | 'en-US' = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN') {
    $setLocale(next);
}

/** 侧栏点选会话：首页就地切换；其余页面跳到该会话所属智能体的对话页 */
function onSelectConversation(payload: { id: string; agentId: string }) {
    selectConversation(payload.agentId, payload.id);
    const agentPath = `/chat/${encodeURIComponent(payload.agentId)}`;
    if (route.path === '/' || route.path === agentPath) return;
    return navigateTo(`${agentPath}?c=${encodeURIComponent(payload.id)}`);
}

/** 新建对话：清掉选中态；对话页回到该智能体无 ?c= 的页面，其余页面回首页 */
function onCreateConversation() {
    startNewChat();
    if (agentIdParam.value) return navigateTo(`/chat/${encodeURIComponent(agentIdParam.value)}`);
    if (route.path !== '/') return navigateTo('/');
}

/** 删掉的正是当前会话时，切到同列表里剩下最近的一条，没有则回到新对话 */
function onConversationDeleted(id: string) {
    if (activeConversationId.value === id) {
        activeConversationId.value = visibleConversations.value.find((c) => c.id !== id)?.id ?? null;
        if (activeConversationId.value) selectConversation('', activeConversationId.value);
    }
    refreshConversations();
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
    <div class="bg-surface-2 text-strong min-h-dvh antialiased">
        <a href="#main" class="app-skip-link">{{ t('common.skipToContent') }}</a>

        <!-- 桌面左侧栏：功能导航 + 会话列表 + 设置区 -->
        <aside class="border-line bg-surface fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r lg:flex" :aria-label="t('common.navigation')">
            <NuxtLink to="/" class="group flex shrink-0 items-center gap-2.5 px-4 py-4">
                <span class="app-avatar h-9 w-9 text-sm shadow-xs transition-transform group-hover:scale-105">W</span>
                <span class="text-brand truncate text-lg font-black tracking-tight">{{ siteTitle }}</span>
            </NuxtLink>

            <nav class="min-h-0 shrink space-y-1 overflow-y-auto px-3 py-2">
                <template v-for="group in navGroups" :key="group.title">
                    <p class="app-sidebar-group-title !px-2">{{ group.title }}</p>
                    <NuxtLink
                        v-for="link in group.links"
                        :key="link.to"
                        :to="link.to"
                        class="app-sidebar-link"
                        :class="isNavActive(link.match) ? 'app-sidebar-link-active' : ''"
                        :aria-current="isNavActive(link.match) ? 'page' : undefined"
                    >
                        <AppIcon :name="link.icon" :size="17" />
                        <span>{{ link.label }}</span>
                    </NuxtLink>
                </template>
            </nav>

            <!-- 命令面板入口：快捷键是隐性的，看得见的路径（带 ⌘K 角标的按钮）才是发现方式 -->
            <div class="shrink-0 px-3 pb-1">
                <button type="button" class="app-btn app-btn-outline app-btn-block !justify-start gap-2 !text-xs" @click="palette?.openPalette()">
                    <AppIcon name="magnify" :size="15" class="text-faint" />
                    <span>{{ t('work.paletteTitle') }}</span>
                    <kbd class="text-faint ml-auto rounded border border-[color:var(--line)] px-1.5 py-0.5 text-[10px]">⌘K</kbd>
                </button>
            </div>

            <!-- 中间段：新建对话 + 对话记录 -->
            <ConversationList
                class="border-line min-h-0 flex-1 border-t"
                :conversations="visibleConversations"
                :active-id="activeConversationId"
                :loading="conversationsPending"
                :error="conversationError"
                :show-agent-name="!agentIdParam"
                @select="onSelectConversation"
                @create="onCreateConversation"
                @changed="refreshConversations()"
                @deleted="onConversationDeleted"
            />

            <!-- 底部设置区：外观、语言、版权；设置项全部落在这里而不是顶部 -->
            <div class="border-line shrink-0 space-y-3 border-t p-3">
                <ThemeSwitcher variant="panel" />

                <!-- 抽屉是导航面板而非 role=menu，这里不能标 menuitem -->
                <button type="button" class="app-dropdown-item" @click="switchLocale()">
                    <AppIcon name="translate" :size="17" />
                    <span>{{ otherLocaleLabel }}</span>
                </button>

                <p class="text-faint px-1 text-xs">© {{ new Date().getFullYear() }} {{ siteTitle }}</p>
            </div>
        </aside>

        <!-- 窄屏顶栏：只有抽屉入口与品牌，导航/会话/外观/语言都在抽屉里 -->
        <header
            class="border-line sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur-md lg:hidden"
            style="border-color: var(--line); background-color: color-mix(in oklab, var(--surface) 85%, transparent)"
        >
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
            <NuxtLink to="/" class="flex min-w-0 items-center gap-2.5">
                <span class="app-avatar h-8 w-8 text-xs shadow-xs">W</span>
                <span class="text-brand truncate text-base font-black tracking-tight">{{ siteTitle }}</span>
            </NuxtLink>
            <!-- 窄屏没有侧栏，命令面板的入口挂在顶栏右侧 -->
            <button type="button" class="app-btn app-btn-ghost app-btn-icon ml-auto" :aria-label="t('work.paletteTitle')" @click="palette?.openPalette()">
                <AppIcon name="magnify" :size="18" />
            </button>
        </header>

        <div class="lg:pl-64">
            <main id="main" class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
                <slot />
            </main>
        </div>

        <!--
            移动端导航抽屉。遮罩与抽屉的入场动画写在 CSS 里（.app-drawer-backdrop / .app-drawer-left），
            不用 <Transition> 包裹：外层容器一旦拿到 transform 就会成为 fixed 子元素的包含块，
            而该容器自身高度为 0，会把抽屉压成 0 高度。
        -->
        <!-- 命令面板：全局快捷键在组件内部注册（布局常驻，切页不会重复挂载） -->
        <WorkCommandPalette ref="palette" />

        <Teleport to="body">
            <div v-if="drawerOpen" class="lg:hidden">
                <div class="app-drawer-backdrop" @click="drawerOpen = false" />
                <aside
                    id="shell-drawer"
                    ref="drawerRef"
                    class="app-drawer app-drawer-left safe-top safe-bottom"
                    role="dialog"
                    aria-modal="true"
                    :aria-label="t('common.navigation')"
                >
                    <div class="border-line flex shrink-0 items-center justify-between border-b px-4 py-3">
                        <span class="flex items-center gap-2.5">
                            <span class="app-avatar h-8 w-8 text-xs">W</span>
                            <span class="text-brand text-sm font-black">{{ siteTitle }}</span>
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

                    <!-- 抽屉本体自带 1rem padding（theme.css），这里去掉后由三段各自控制内边距 -->
                    <div class="app-drawer-body flex min-h-0 flex-1 flex-col !p-0">
                        <nav class="shrink-0 space-y-1 px-3 py-2">
                            <template v-for="group in navGroups" :key="group.title">
                                <p class="app-sidebar-group-title !px-2">{{ group.title }}</p>
                                <NuxtLink
                                    v-for="link in group.links"
                                    :key="link.to"
                                    :to="link.to"
                                    class="app-sidebar-link"
                                    :class="isNavActive(link.match) ? 'app-sidebar-link-active' : ''"
                                    :aria-current="isNavActive(link.match) ? 'page' : undefined"
                                >
                                    <AppIcon :name="link.icon" :size="17" />
                                    <span>{{ link.label }}</span>
                                </NuxtLink>
                            </template>
                        </nav>

                        <ConversationList
                            class="border-line min-h-0 flex-1 border-t"
                            :conversations="visibleConversations"
                            :active-id="activeConversationId"
                            :loading="conversationsPending"
                            :error="conversationError"
                            :show-agent-name="!agentIdParam"
                            @select="onSelectConversation"
                            @create="onCreateConversation"
                            @changed="refreshConversations()"
                            @deleted="onConversationDeleted"
                        />

                        <div class="border-line shrink-0 space-y-3 border-t p-3">
                            <ThemeSwitcher variant="panel" />

                            <button type="button" class="app-dropdown-item" @click="switchLocale()">
                                <AppIcon name="translate" :size="17" />
                                <span>{{ otherLocaleLabel }}</span>
                            </button>

                            <p class="text-faint px-1 text-xs">© {{ new Date().getFullYear() }} {{ siteTitle }}</p>
                        </div>
                    </div>
                </aside>
            </div>
        </Teleport>
    </div>
</template>
