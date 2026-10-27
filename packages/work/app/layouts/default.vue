<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { WORK_NAV_LINKS } from '../utils/work-nav';

/**
 * 工作台外壳：固定左栏的三段式布局。
 *
 * 左栏自上而下 **顶部导航 / 空间 / 最近对话 / 系统设置**：
 * - 顶部是「新建对话」+ 首页/运行/资料/自动化；空间作为独立列表；底部只保留系统设置。
 * - 中间先放空间列表，再放全局最近对话。设置区使用独立 layout，不会进入这里。
 * - 对话历史仍常驻工作台页面；任何工作台页面都能就地切会话。
 * - 底部是系统设置单一入口（外观、语言与八个子页都从那里进），底栏不再摆第二套主题/语言开关。
 *
 * - ≥ lg：固定左侧栏占满高度；主内容区 `lg:pl-64`，没有顶部导航栏与页脚。
 * - < lg：左栏收成左侧抽屉，只留一条极窄顶栏（汉堡 + Logo）作为抽屉入口，抽屉是同一套三段。
 * - 会话列表与选中态由 `useChatSidebar` 提供：布局拉数据、渲染左栏，聊天页只消费，
 *   避免侧栏与页面各拉一份、选中态分叉。
 * - 主题 CSS 未分层：.app-btn 的 display 会压掉 utilities 层的响应式隐藏，
 *   所以顶栏上的汉堡按钮必须包在外层 lg:hidden 容器里（顶栏自身已是 lg:hidden）。
 * - 抽屉是导航面板（不是 role=menu），布局内的 Tab 圈闭/滚动锁是唯一实现，勿另造。
 */
const { t } = useI18n();
/** 名称可被通用设置页改名，所以走 useState 镜像而不是直接读非响应式的 runtimeConfig */
const siteTitle = useSiteTitle();
const { show: showCommandPalette } = useCommandPalette();

const route = useRoute();
/** 抽屉开关：布局持有，ChatPane 头部的历史按钮（窄屏）也开同一个抽屉 */
const { open: drawerOpen } = useShellDrawer();
const drawerRef = ref<HTMLElement | null>(null);

/** 会话列表与选中态：左栏渲染，聊天页消费 */
const {
    spaces,
    conversations,
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

/** 设置区使用独立内容布局：不再把会话历史挂在每一张配置页旁边。 */
const isSettingsSurface = computed(() => route.path === '/settings' || route.path.startsWith('/settings/'));

const conversationError = computed(() => (conversationsError.value ? t('common.loadFailed') : ''));

/**
 * 后台生成轮次的可见性。
 *
 * 布局常驻、且是侧栏数据的唯一持有者，所以「哪条会话还在跑」的两条口径都在这里收敛：
 * - 本地登记的实例（切页面时不销毁，见 `useChatRuns`）
 * - 服务端在途轮次（刷新页面后本地一个实例都没有，只能问 `/api/chat/runs`）
 *
 * 某一轮从「在跑」变成「跑完」时必须刷新列表：服务端在这时回填自动标题、`updatedAt` 也随之变化，
 * 不刷新就是「角标消失了，但那条会话还挂在列表中间且顶着旧名字」。
 */
const { runningIds, refreshRemoteRuns } = useChatRuns();
onMounted(refreshRemoteRuns);

/**
 * 正在展示对话的页面：`/chat`（可切换智能体）与 `/chat/:agentId`。
 *
 * `/agents` 是智能体广场，屏幕上没有任何会话，所以它不算——广场也会给 `effectiveConversationId`
 * 算出一条会话来，把它当「正在看」会让完成提示被吞掉、阅读记录被误写。
 * 会话列表本身已经常驻，这个判据只留给「要不要记已读」和「要不要打完成提示」。
 */
const isChatSurface = computed(() => route.path === '/chat' || route.path.startsWith('/chat/'));

/**
 * 后台那一轮跑完时的提示。
 *
 * 用户切走（甚至刷新过页面）之后，回复只是安静地落进侧栏，而生成动辄几十秒——
 * 「完成」这件事必须自己冒出来一次，否则后台运行等于把结果藏起来。
 * 正在看这一段会话时不打扰：流就在屏幕上，用户已经跟着看完了。
 */
const finishedNotice = ref<{ id: string; title: string; path: string } | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function clearFinishedNotice() {
    if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
    }
    finishedNotice.value = null;
}

watch(runningIds, async (next, prev) => {
    const finished = (prev ?? []).filter((id) => !next.includes(id));
    if (!finished.length) return;
    // 标题与排序是这一轮收尾时服务端才回填的，先刷新再读，否则提示里还是「新对话」
    await refreshConversations();
    const id = finished[0];
    if (!id) return;
    const conversation = visibleConversations.value.find((c) => c.id === id);
    if (!conversation) return;
    if (isChatSurface.value && activeConversationId.value === id) return;
    clearFinishedNotice();
    finishedNotice.value = {
        id,
        title: conversation.title,
        path: `/chat/${encodeURIComponent(conversation.agentId)}?c=${encodeURIComponent(id)}`,
    };
    noticeTimer = setTimeout(clearFinishedNotice, 12_000);
});

/**
 * 阅读进度：「正在看」才算已读。
 *
 * 只在这两个值同时成立时写记录——聊天页面上、且这条会话就是打开的那条。
 * 于是后台跑完而用户此刻在 /tasks 的那条会留下未读点，等浮层自己消失也不会漏。
 */
const { ensureSeeded, markRead, forgetConversation } = useChatReadState();

const readTarget = computed(() => {
    if (!isChatSurface.value) return null;
    const id = effectiveConversationId.value;
    if (!id) return null;
    const conversation = visibleConversations.value.find((c) => c.id === id);
    return conversation ? { id: conversation.id, updatedAt: conversation.updatedAt } : null;
});

watch(
    readTarget,
    (target) => {
        if (target) markRead(target.id, target.updatedAt);
    },
    { immediate: true },
);
// 第一次使用（这份浏览器还没有任何记录）时整表播种为已读，避免一装上就看到满屏未读点。
// 必须用**完整列表**：`/chat/:agentId` 下 visibleConversations 只剩当前智能体的会话，
// 首次使用若恰好从该页进来，其它智能体的历史永远进不了 seen，之后回到 /chat 会满屏未读点。
watch(conversations, (list) => ensureSeeded(list), { immediate: true });

/**
 * 侧栏顶部那一段功能导航。
 *
 * 清单在 `utils/work-nav`，桌面与抽屉各渲染一次同一份——之前两处各写一遍时，同一个页面会有两套名字。
 * 智能体广场（`/agents`）刻意不占一项——它和「对话」是同一件事的两面，入口交给对话头部的切换器。
 */
const navLinks = WORK_NAV_LINKS;
const primaryLinks = navLinks.filter((link) => link.to !== '/spaces');

function isNavActive(match: string) {
    const path = route.path;
    if (match === '/') return path === '/';
    if (match === '/tasks' && (path === '/runs' || path.startsWith('/runs/'))) return true;
    return path === match || path.startsWith(`${match}/`);
}

/**
 * 侧栏点选会话：就地切换。
 *
 * 列表现在在所有页面都出现，所以在 /tasks 上点一条会话要先把人带回对话：
 * 只改共享选中态而不换路由，屏幕上还是任务表，用户会以为点击没生效。
 */
function onSelectConversation(payload: { id: string; agentId: string }) {
    // 就地切换不改路由，route 监听不会关抽屉；窄屏下用户点完会话是要看对话，不是看抽屉
    drawerOpen.value = false;
    selectConversation(payload.agentId, payload.id);
    if (!isChatSurface.value) return navigateTo(`/chat/${encodeURIComponent(payload.agentId)}?c=${encodeURIComponent(payload.id)}`);
    // 对话页就地切会话：把选中的 id 写回 URL（replace，不往浏览器历史里塞一串会话）。
    // 不写的话刷新会回到 URL 里那条旧会话，从完成提示/侧栏复制出去的链接也永远停在进入本页时那一条。
    if (route.query.c === payload.id) return;
    return navigateTo({ path: route.path, query: { ...route.query, c: payload.id } }, { replace: true });
}

/** 新建对话：清掉选中态；对话页还要把 URL 里的 `?c=` 摘掉，否则刷新会回到刚才那条 */
function onCreateConversation() {
    drawerOpen.value = false;
    startNewChat();
    if (agentIdParam.value) return navigateTo(`/chat/${encodeURIComponent(agentIdParam.value)}`);
    if (route.path === '/chat' && !route.query.c && !route.query.space) return;
    const query = { ...route.query };
    delete query.c;
    // 侧栏的「新建对话」是独立对话；空间里的新对话必须从空间主页进入并带 ?space=。
    delete query.space;
    return navigateTo({ path: '/chat', query });
}

/** 会话被就地改名后刷新列表，并把这条重新记为已读（PATCH 会顶动 updatedAt，但它不该亮未读点） */
async function onConversationsChanged(id: string) {
    await refreshConversations();
    const conversation = visibleConversations.value.find((c) => c.id === id);
    if (conversation) markRead(conversation.id, conversation.updatedAt);
}

/** 删掉的正是当前会话时，切到同列表里剩下最近的一条，没有则回到新对话 */
function onConversationDeleted(id: string) {
    if (finishedNotice.value?.id === id) clearFinishedNotice();
    forgetConversation(id);
    if (activeConversationId.value === id) {
        // 必须把这条会话真实的 agentId 一起交回去：`/chat` 的列表是跨智能体的，
        // 传空串会让 effectiveAgentId 退回「列表第一条的智能体」，而选中项可能是另一条，
        // 于是 ChatPane 拿到「A 的 transport + B 的会话」，下一次发送被服务端 400。
        const next = visibleConversations.value.find((c) => c.id !== id);
        if (next) selectConversation(next.agentId, next.id);
        else activeConversationId.value = null;
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
    clearFinishedNotice();
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

        <!-- 桌面左侧栏：顶部导航 / 空间 / 最近对话 / 系统设置 -->
        <aside class="border-line bg-surface fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r lg:flex" :aria-label="t('common.navigation')">
            <NuxtLink to="/" class="group flex shrink-0 items-center gap-2.5 px-4 py-4">
                <span class="app-avatar h-9 w-9 text-sm shadow-xs transition-transform group-hover:scale-105">W</span>
                <span class="text-brand truncate text-lg font-black tracking-tight">{{ siteTitle }}</span>
            </NuxtLink>

            <!-- 第一段：工作台。新建对话与功能导航同级——它是「开始一件事」，不是历史列表的一个操作 -->
            <nav class="shrink-0 space-y-1 px-3 pb-2" :aria-label="t('nav.groupWork')">
                <div v-if="!isSettingsSurface" class="space-y-1.5 px-2 pb-1.5">
                    <button type="button" class="app-btn app-btn-primary app-btn-block gap-1.5 !text-xs" @click="onCreateConversation">
                        <AppIcon name="plus" :size="15" />
                        <span>{{ t('chat.newChat') }}</span>
                    </button>
                    <button type="button" class="app-btn app-btn-outline app-btn-block justify-between !px-2.5 !py-1.5 !text-xs" @click="showCommandPalette">
                        <span class="flex items-center gap-1.5">
                            <AppIcon name="magnify" :size="14" class="text-faint" />
                            <span class="text-soft">{{ t('commandPalette.searchButton') }}</span>
                        </span>
                        <kbd class="text-faint rounded border border-[color:var(--line)] px-1.5 py-0.5 font-mono text-[10px]">Ctrl+K</kbd>
                    </button>
                </div>
                <NuxtLink
                    v-for="link in primaryLinks"
                    :key="link.to"
                    :to="link.to"
                    class="app-sidebar-link"
                    :class="isNavActive(link.match) ? 'app-sidebar-link-active' : ''"
                    :aria-current="isNavActive(link.match) ? 'page' : undefined"
                >
                    <AppIcon :name="link.icon" :size="17" />
                    <span>{{ t(link.labelKey) }}</span>
                </NuxtLink>
            </nav>

            <!-- 第二段：空间列表 + 全局最近对话。设置区不渲染这段。 -->
            <div v-if="!isSettingsSurface && spaces.length" class="shrink-0 px-3 pb-2">
                <div class="flex items-center justify-between px-2 pb-1">
                    <span class="text-faint text-[10px] font-bold tracking-wide uppercase">{{ t('nav.spaces') }}</span>
                    <NuxtLink to="/spaces" class="text-hover-brand text-[10px] font-bold">{{ t('nav.manageSpaces') }}</NuxtLink>
                </div>
                <NuxtLink v-for="space in spaces.slice(0, 5)" :key="space.id" :to="`/spaces/${encodeURIComponent(space.id)}`" class="app-sidebar-link !py-1.5">
                    <span class="text-base">{{ space.icon }}</span>
                    <span class="truncate">{{ space.name }}</span>
                </NuxtLink>
            </div>
            <div v-if="!isSettingsSurface" class="flex shrink-0 items-center justify-between px-5 pt-3 pb-1">
                <span class="text-faint text-[10px] font-bold tracking-wide uppercase">{{ t('nav.recentChats') }}</span>
                <span class="text-faint text-[10px]">{{ visibleConversations.length }}</span>
            </div>
            <ConversationList
                v-if="!isSettingsSurface"
                class="min-h-0 flex-1"
                :conversations="visibleConversations"
                :active-id="activeConversationId"
                :loading="conversationsPending"
                :error="conversationError"
                :show-agent-name="!agentIdParam"
                @select="onSelectConversation"
                @changed="onConversationsChanged"
                @deleted="onConversationDeleted"
            />
            <div v-else class="min-h-0 flex-1" />

            <!-- 第三段：只保留系统设置；运行/资料/自动化在顶部导航。 -->
            <div class="border-line shrink-0 border-t px-3 py-2">
                <NuxtLink
                    to="/settings"
                    class="app-sidebar-link !py-1.5"
                    :class="isNavActive('/settings') ? 'app-sidebar-link-active' : ''"
                    :aria-current="isNavActive('/settings') ? 'page' : undefined"
                >
                    <AppIcon name="cog-outline" :size="17" />
                    <span>{{ t('nav.systemSettings') }}</span>
                </NuxtLink>
            </div>
        </aside>

        <!-- 窄屏顶栏：只有抽屉入口与品牌，导航/会话/设置都在抽屉里 -->
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
            <button type="button" class="app-btn app-btn-ghost app-btn-icon ml-auto" :aria-label="t('commandPalette.searchButton')" @click="showCommandPalette">
                <AppIcon name="magnify" :size="19" />
            </button>
        </header>

        <div class="lg:pl-64">
            <main id="main" class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
                <slot />
            </main>
        </div>

        <!--
            后台那一轮跑完的提示：右下角浮层而不是弹窗。用户可能正在别的页面输入，
            `role="status"`（polite）只播报一次、不打断输入；12 秒自动收起，也可手动关。
            放在布局而不是 ChatPane：切走之后 ChatPane 已经不在那段会话上了。
        -->
        <Teleport to="body">
            <div
                v-if="finishedNotice"
                role="status"
                class="app-card fixed inset-x-3 bottom-3 z-50 flex items-center gap-2 py-2.5 pr-2 pl-3 !shadow-lg sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[22rem]"
            >
                <AppIcon name="check-circle-outline" :size="18" class="shrink-0 text-[color:var(--success)]" />
                <p class="min-w-0 flex-1 truncate text-sm">{{ t('work.backgroundDone', { title: finishedNotice.title }) }}</p>
                <NuxtLink :to="finishedNotice.path" class="app-btn app-btn-soft app-btn-sm shrink-0" @click="clearFinishedNotice()">
                    {{ t('work.backgroundOpen') }}
                </NuxtLink>
                <button type="button" class="app-btn app-btn-ghost app-btn-icon shrink-0" :aria-label="t('common.close')" @click="clearFinishedNotice()">
                    <AppIcon name="close" :size="16" />
                </button>
            </div>
        </Teleport>

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
                        <nav class="shrink-0 space-y-1 px-3 pb-2" :aria-label="t('nav.groupWork')">
                            <div v-if="!isSettingsSurface" class="px-2 pb-1.5">
                                <button type="button" class="app-btn app-btn-primary app-btn-block gap-1.5 !text-xs" @click="onCreateConversation">
                                    <AppIcon name="plus" :size="15" />
                                    <span>{{ t('chat.newChat') }}</span>
                                </button>
                            </div>
                            <NuxtLink
                                v-for="link in primaryLinks"
                                :key="link.to"
                                :to="link.to"
                                class="app-sidebar-link"
                                :class="isNavActive(link.match) ? 'app-sidebar-link-active' : ''"
                                :aria-current="isNavActive(link.match) ? 'page' : undefined"
                            >
                                <AppIcon :name="link.icon" :size="17" />
                                <span>{{ t(link.labelKey) }}</span>
                            </NuxtLink>
                        </nav>

                        <div v-if="!isSettingsSurface && spaces.length" class="shrink-0 px-3 pb-2">
                            <div class="flex items-center justify-between px-2 pb-1">
                                <span class="text-faint text-[10px] font-bold tracking-wide uppercase">{{ t('nav.spaces') }}</span>
                                <NuxtLink to="/spaces" class="text-hover-brand text-[10px] font-bold">{{ t('nav.manageSpaces') }}</NuxtLink>
                            </div>
                            <NuxtLink
                                v-for="space in spaces.slice(0, 5)"
                                :key="space.id"
                                :to="`/spaces/${encodeURIComponent(space.id)}`"
                                class="app-sidebar-link !py-1.5"
                            >
                                <span class="text-base">{{ space.icon }}</span>
                                <span class="truncate">{{ space.name }}</span>
                            </NuxtLink>
                        </div>
                        <div v-if="!isSettingsSurface" class="flex shrink-0 items-center justify-between px-5 pt-3 pb-1">
                            <span class="text-faint text-[10px] font-bold tracking-wide uppercase">{{ t('nav.recentChats') }}</span>
                            <span class="text-faint text-[10px]">{{ visibleConversations.length }}</span>
                        </div>
                        <ConversationList
                            v-if="!isSettingsSurface"
                            class="min-h-0 flex-1"
                            :conversations="visibleConversations"
                            :active-id="activeConversationId"
                            :loading="conversationsPending"
                            :error="conversationError"
                            :show-agent-name="!agentIdParam"
                            @select="onSelectConversation"
                            @changed="onConversationsChanged"
                            @deleted="onConversationDeleted"
                        />
                        <div v-else class="min-h-0 flex-1" />

                        <div class="border-line shrink-0 border-t px-3 py-2">
                            <NuxtLink
                                to="/settings"
                                class="app-sidebar-link !py-1.5"
                                :class="isNavActive('/settings') ? 'app-sidebar-link-active' : ''"
                                :aria-current="isNavActive('/settings') ? 'page' : undefined"
                            >
                                <AppIcon name="cog-outline" :size="17" />
                                <span>{{ t('nav.systemSettings') }}</span>
                            </NuxtLink>
                        </div>
                    </div>
                </aside>
            </div>
        </Teleport>
        <WorkCommandPalette />
    </div>
</template>
