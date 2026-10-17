<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dayInputValue } from '../utils/work';
import { WORK_NAV_GROUPS } from '../utils/work-nav';

/**
 * 工作台外壳（主流 AI 工作台布局：固定左栏 + 无顶部导航）。
 *
 * 左栏自上而下：品牌 / 命令面板入口 / 功能导航 / 会话列表。
 * 会话列表只在对话面（`/chat`、`/chat/:agentId`）展开——它属于对话，其余页面把这列的空间还给导航。
 * 外观、语言与站点名称都只有一处入口（`/settings` 通用页），底栏不再摆第二套。
 *
 * - ≥ lg：固定左侧栏占满高度；主内容区 `lg:pl-64`，没有顶部导航栏与页脚。
 * - < lg：左栏收成左侧抽屉，只留一条极窄顶栏（汉堡 + Logo + 面板入口）作为抽屉入口。
 * - 会话列表与选中态由 `useChatSidebar` 提供：布局拉数据、渲染左栏，聊天页只消费，
 *   避免侧栏与页面各拉一份、选中态分叉。
 * - 主题 CSS 未分层：.app-btn 的 display 会压掉 utilities 层的响应式隐藏，
 *   所以顶栏上的汉堡按钮必须包在外层 lg:hidden 容器里（顶栏自身已是 lg:hidden）。
 * - 抽屉是导航面板（不是 role=menu），布局内的 Tab 圈闭/滚动锁是唯一实现，勿另造。
 */
const { t } = useI18n();
/** 名称可被通用设置页改名，所以走 useState 镜像而不是直接读非响应式的 runtimeConfig */
const siteTitle = useSiteTitle();

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
 * 同一个判据还决定左栏要不要展开会话列表。
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
// 第一次使用（这份浏览器还没有任何记录）时整表播种为已读，避免一装上就看到满屏未读点
watch(visibleConversations, (list) => ensureSeeded(list), { immediate: true });

/**
 * 日程提醒到点。
 *
 * 提醒过去只是抽屉里一个写进库的时间，界面不会因此发生任何事——这一层才是它的作用时刻。
 * 只在布局挂载期间轮询（工作台没有后台守护、也没有推送），所以浮层刻意驻留得比会话完成提示更久：
 * 用户回到屏幕前得来得及读完「该做什么」，而不只是看见它闪了一下。
 */
const { due: dueReminder, dismiss: dismissReminder, startPolling, stopPolling } = useEventReminders();
const REMINDER_NOTICE_MS = 45_000;
let reminderTimer: ReturnType<typeof setTimeout> | null = null;

function clearReminderTimer() {
    if (reminderTimer) {
        clearTimeout(reminderTimer);
        reminderTimer = null;
    }
}

function closeReminder() {
    clearReminderTimer();
    dismissReminder();
}

watch(dueReminder, (event) => {
    clearReminderTimer();
    if (!event) return;
    reminderTimer = setTimeout(closeReminder, REMINDER_NOTICE_MS);
});

/** 提醒深链到那一天：`?day=` 是日历页锚定的本机日，点开就能直接落在这条日程所在的格子上 */
const reminderPath = computed(() => {
    const event = dueReminder.value;
    if (!event) return '';
    const day = dayInputValue(event.startsAt);
    return `/calendar${day ? `?day=${encodeURIComponent(day)}` : ''}`;
});

onMounted(startPolling);

/**
 * 侧栏分组导航（Linear / Notion 的写法：条目多了靠分组标题保持可扫读）。
 *
 * 清单在 `utils/work-nav`，命令面板的「前往」组读同一份——两处各写一遍时，同一个页面会有两套名字。
 * 智能体广场（`/agents`）刻意不占一项——它和「对话」是同一件事的两面，入口交给对话头部的切换器与命令面板。
 * 桌面端与抽屉共用这里的一份，两侧不会因某次只改一处而菜单项分叉。
 */
const navGroups = WORK_NAV_GROUPS;

function isNavActive(match: string) {
    const path = route.path;
    return match === '/' ? path === '/' : path === match || path.startsWith(`${match}/`);
}

/**
 * 侧栏点选会话：就地切换。
 *
 * 会话列表只在对话面（`/chat`、`/chat/:agentId`）渲染，所以这里永远不需要跳路由——
 * `/chat` 上选到别的智能体的会话由 ChatPane 按 props 换人，`/chat/:agentId` 上列表本来就只列该智能体。
 */
function onSelectConversation(payload: { id: string; agentId: string }) {
    // 就地切换不改 URL，route 监听不会关抽屉；窄屏下用户点完会话是要看对话，不是看抽屉
    drawerOpen.value = false;
    selectConversation(payload.agentId, payload.id);
}

/** 新建对话：清掉选中态；对话页还要把 URL 里的 `?c=` 摘掉，否则刷新会回到刚才那条 */
function onCreateConversation() {
    drawerOpen.value = false;
    startNewChat();
    if (agentIdParam.value) return navigateTo(`/chat/${encodeURIComponent(agentIdParam.value)}`);
    if (route.path !== '/chat') return navigateTo('/chat');
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
    clearFinishedNotice();
    clearReminderTimer();
    stopPolling();
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

        <!-- 桌面左侧栏：品牌 + 命令面板入口 + 功能导航（对话面再往下展开会话列表） -->
        <aside class="border-line bg-surface fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r lg:flex" :aria-label="t('common.navigation')">
            <NuxtLink to="/" class="group flex shrink-0 items-center gap-2.5 px-4 py-4">
                <span class="app-avatar h-9 w-9 text-sm shadow-xs transition-transform group-hover:scale-105">W</span>
                <span class="text-brand truncate text-lg font-black tracking-tight">{{ siteTitle }}</span>
            </NuxtLink>

            <!-- 命令面板入口放在导航之上：它是这列导航的键盘版，快捷键是隐性的，看得见的路径（带 ⌘K 角标的按钮）才是发现方式 -->
            <div class="shrink-0 px-3 pb-2">
                <button type="button" class="app-btn app-btn-outline app-btn-block !justify-start gap-2 !text-xs" @click="palette?.openPalette()">
                    <AppIcon name="magnify" :size="15" class="text-faint" />
                    <span>{{ t('work.paletteTitle') }}</span>
                    <kbd class="text-faint ml-auto rounded border border-[color:var(--line)] px-1.5 py-0.5 text-[10px]">⌘K</kbd>
                </button>
            </div>

            <nav class="min-h-0 space-y-1 overflow-y-auto px-3 py-2" :class="isChatSurface ? 'shrink-0' : 'flex-1'">
                <template v-for="group in navGroups" :key="group.titleKey">
                    <p class="app-sidebar-group-title !px-2">{{ t(group.titleKey) }}</p>
                    <NuxtLink
                        v-for="link in group.links"
                        :key="link.to"
                        :to="link.to"
                        class="app-sidebar-link"
                        :class="isNavActive(link.match) ? 'app-sidebar-link-active' : ''"
                        :aria-current="isNavActive(link.match) ? 'page' : undefined"
                    >
                        <AppIcon :name="link.icon" :size="17" />
                        <span>{{ t(link.labelKey) }}</span>
                    </NuxtLink>
                </template>
            </nav>

            <!-- 会话列表属于对话：只在对话面展开，其余页面不占这列的高度 -->
            <ConversationList
                v-if="isChatSurface"
                class="border-line min-h-0 flex-1 border-t"
                :conversations="visibleConversations"
                :active-id="activeConversationId"
                :loading="conversationsPending"
                :error="conversationError"
                :show-agent-name="!agentIdParam"
                @select="onSelectConversation"
                @create="onCreateConversation"
                @changed="onConversationsChanged"
                @deleted="onConversationDeleted"
            />
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
            日程提醒到点。与上面那条完成提示分处对角（窄屏在上、桌面在左下）：
            两条浮层可能同时在，叠在一起就谁都读不到。
        -->
        <Teleport to="body">
            <div
                v-if="dueReminder"
                role="status"
                class="app-card fixed inset-x-3 top-16 z-50 flex items-center gap-2 py-2.5 pr-2 pl-3 !shadow-lg sm:inset-x-auto sm:top-auto sm:bottom-6 sm:left-72 sm:w-[22rem]"
            >
                <AppIcon name="bell-outline" :size="18" class="shrink-0 text-[color:var(--warning)]" />
                <p class="min-w-0 flex-1 truncate text-sm">{{ t('work.reminderDue', { title: dueReminder.title }) }}</p>
                <NuxtLink :to="reminderPath" class="app-btn app-btn-soft app-btn-sm shrink-0" @click="closeReminder">{{ t('common.viewDetail') }}</NuxtLink>
                <button type="button" class="app-btn app-btn-ghost app-btn-icon shrink-0" :aria-label="t('common.close')" @click="closeReminder">
                    <AppIcon name="close" :size="16" />
                </button>
            </div>
        </Teleport>

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

                    <!-- 抽屉本体自带 1rem padding（theme.css），这里去掉后由两段各自控制内边距 -->
                    <div class="app-drawer-body flex min-h-0 flex-1 flex-col !p-0">
                        <nav class="space-y-1 px-3 py-2" :class="isChatSurface ? 'shrink-0' : 'min-h-0 flex-1 overflow-y-auto'">
                            <template v-for="group in navGroups" :key="group.titleKey">
                                <p class="app-sidebar-group-title !px-2">{{ t(group.titleKey) }}</p>
                                <NuxtLink
                                    v-for="link in group.links"
                                    :key="link.to"
                                    :to="link.to"
                                    class="app-sidebar-link"
                                    :class="isNavActive(link.match) ? 'app-sidebar-link-active' : ''"
                                    :aria-current="isNavActive(link.match) ? 'page' : undefined"
                                >
                                    <AppIcon :name="link.icon" :size="17" />
                                    <span>{{ t(link.labelKey) }}</span>
                                </NuxtLink>
                            </template>
                        </nav>

                        <ConversationList
                            v-if="isChatSurface"
                            class="border-line min-h-0 flex-1 border-t"
                            :conversations="visibleConversations"
                            :active-id="activeConversationId"
                            :loading="conversationsPending"
                            :error="conversationError"
                            :show-agent-name="!agentIdParam"
                            @select="onSelectConversation"
                            @create="onCreateConversation"
                            @changed="onConversationsChanged"
                            @deleted="onConversationDeleted"
                        />
                    </div>
                </aside>
            </div>
        </Teleport>
    </div>
</template>
