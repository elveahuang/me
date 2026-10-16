<script setup lang="ts">
import { extractApiError, formatDate } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { relativeDayLabel, todayInputValue, type WorkTaskStatus } from '../utils/work';
import { WORK_SETTINGS_PAGES } from '../utils/work-settings';

/**
 * 全局命令面板（⌘/Ctrl + K）。
 *
 * 数据源是 `GET /api/search`：一次查遍任务/笔记/日程/项目，四个分组各带 limit，
 * 比在面板里分别打四个接口少三次往返，也让「同一关键词的四类结果」天然对齐同一时刻。
 *
 * 输入走防抖而不是逐字符请求：面板打开后用户通常连打几个字，
 * 每次键入都发一条四表 ILIKE 会让最慢那一次后回、把结果覆盖成旧关键词的（seq 守卫兜住这一点）。
 */
const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();

interface SearchHitTask {
    id: string;
    title: string;
    status: WorkTaskStatus;
    dueAt: string | null;
}
interface SearchHitNote {
    id: string;
    title: string;
    kind: string;
    snippet: string;
}
interface SearchHitEvent {
    id: string;
    title: string;
    startsAt: string;
    allDay: boolean;
}
interface SearchHitProject {
    id: string;
    name: string;
    archived: boolean;
}
interface SearchResult {
    q: string;
    tasks: SearchHitTask[];
    notes: SearchHitNote[];
    events: SearchHitEvent[];
    projects: SearchHitProject[];
}

const open = ref(false);
const keyword = ref('');
const busy = ref(false);
const failed = ref('');
const result = ref<SearchResult | null>(null);
const highlight = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const today = todayInputValue();

interface Command {
    id: string;
    label: string;
    /** 分组标题；同组条目必须相邻，分组标题按「与上一条不同」渲染 */
    group: string;
    hint?: string;
    icon: string;
    run: () => void;
}

/**
 * 设置区的子页面（清单见 utils/work-settings，与子导航、通用页入口卡片同一份）。
 *
 * 侧栏里它们收在「系统设置」一项之下，要两步才够得着；命令面板是这条路径上唯一的单步入口，
 * 少了它就等于「页面存在，但只能靠点侧栏发现」。
 */
const commands = computed<Command[]>(() => [
    { id: 'go-today', group: t('work.cmdGroupGo'), label: t('work.cmdGoToday'), icon: 'view-dashboard-outline', run: () => go('/') },
    { id: 'go-tasks', group: t('work.cmdGroupGo'), label: t('work.cmdGoTasks'), icon: 'check-all', run: () => go('/tasks') },
    { id: 'go-calendar', group: t('work.cmdGroupGo'), label: t('work.cmdGoCalendar'), icon: 'calendar-check-outline', run: () => go('/calendar') },
    { id: 'go-notes', group: t('work.cmdGroupGo'), label: t('work.cmdGoNotes'), icon: 'book-open-page-variant-outline', run: () => go('/notes') },
    { id: 'go-projects', group: t('work.cmdGroupGo'), label: t('work.cmdGoProjects'), icon: 'folder-outline', run: () => go('/projects') },
    { id: 'go-chat', group: t('work.cmdGroupGo'), label: t('work.cmdGoChat'), icon: 'chat-outline', run: () => go('/chat') },
    { id: 'go-agents', group: t('work.cmdGroupGo'), label: t('work.cmdGoAgents'), icon: 'robot-outline', run: () => go('/agents') },
    { id: 'go-attachments', group: t('work.cmdGroupGo'), label: t('work.cmdGoAttachments'), icon: 'file-document-outline', run: () => go('/attachments') },
    ...WORK_SETTINGS_PAGES.map((page) => ({
        id: `go-settings-${page.id}`,
        group: t('work.cmdGroupSettings'),
        label: t(page.labelKey),
        hint: t('nav.systemSettings'),
        icon: page.icon,
        run: () => go(page.to),
    })),
    {
        id: 'new-task',
        group: t('work.cmdGroupActions'),
        label: t('work.cmdNewTask'),
        hint: t('nav.tasks'),
        icon: 'plus-circle-outline',
        run: () => go('/tasks?new=1'),
    },
    {
        id: 'new-note',
        group: t('work.cmdGroupActions'),
        label: t('work.cmdNewNote'),
        hint: t('nav.notes'),
        icon: 'plus-circle-outline',
        run: () => go('/notes?new=1'),
    },
    {
        id: 'new-event',
        group: t('work.cmdGroupActions'),
        label: t('work.cmdNewEvent'),
        hint: t('nav.calendar'),
        icon: 'plus-circle-outline',
        run: () => go('/calendar?new=1'),
    },
    {
        id: 'new-project',
        group: t('work.cmdGroupActions'),
        label: t('work.cmdNewProject'),
        hint: t('nav.projects'),
        icon: 'plus-circle-outline',
        run: () => go('/projects?new=1'),
    },
]);

function go(path: string) {
    close();
    void router.push(path);
}

/** 面板条目 = 命中结果在前、命令在后；空输入时只有命令 */
interface PaletteItem {
    id: string;
    group: string;
    label: string;
    sub?: string;
    icon: string;
    run: () => void;
}

const items = computed<PaletteItem[]>(() => {
    const q = keyword.value.trim();
    const hits: PaletteItem[] = [];
    if (q && result.value) {
        for (const task of result.value.tasks) {
            hits.push({
                id: `task:${task.id}`,
                group: t('nav.tasks'),
                label: task.title || t('work.untitledTask'),
                sub: `${statusText(task.status)}${task.dueAt ? ` · ${relativeDayLabel(task.dueAt, today, t, formatDate)}` : ''}`,
                icon: 'check-all',
                run: () => go(`/tasks?q=${encodeURIComponent(task.title.slice(0, 60))}`),
            });
        }
        for (const note of result.value.notes) {
            hits.push({
                id: `note:${note.id}`,
                group: t('nav.notes'),
                label: note.title || t('work.untitledNote'),
                sub: note.snippet,
                icon: 'book-open-page-variant-outline',
                run: () => go(`/notes/${encodeURIComponent(note.id)}`),
            });
        }
        for (const event of result.value.events) {
            hits.push({
                id: `event:${event.id}`,
                group: t('nav.calendar'),
                label: event.title,
                sub: `${formatDate(event.startsAt)}${event.allDay ? ` · ${t('work.allDay')}` : ''}`,
                icon: 'calendar-outline',
                run: () => go(`/calendar?day=${encodeURIComponent(event.startsAt.slice(0, 10))}`),
            });
        }
        for (const project of result.value.projects) {
            hits.push({
                id: `project:${project.id}`,
                group: t('nav.projects'),
                label: project.name,
                sub: project.archived ? t('work.archivedTag') : '',
                icon: 'folder-outline',
                run: () => go(`/tasks?project=${encodeURIComponent(project.id)}`),
            });
        }
    }
    const rest: PaletteItem[] = commands.value
        .filter((command) => !q || command.label.toLowerCase().includes(q.toLowerCase()))
        .map((command) => ({
            id: command.id,
            group: command.group,
            label: command.label,
            sub: command.hint,
            icon: command.icon,
            run: command.run,
        }));
    return [...hits, ...rest];
});

function statusText(status: WorkTaskStatus): string {
    return { todo: t('work.statusTodo'), doing: t('work.statusDoing'), done: t('work.statusDone'), cancelled: t('work.statusCancelled') }[status];
}

let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

watch(keyword, (value) => {
    if (timer) clearTimeout(timer);
    const q = value.trim();
    highlight.value = 0;
    if (!q) {
        result.value = null;
        busy.value = false;
        failed.value = '';
        return;
    }
    timer = setTimeout(async () => {
        const current = ++seq;
        busy.value = true;
        failed.value = '';
        try {
            const res = await $fetch<SearchResult>('/api/search', { query: { q, limit: 8 } });
            if (current !== seq) return;
            result.value = res;
        } catch (e) {
            if (current !== seq) return;
            result.value = null;
            failed.value = extractApiError(e, t('common.loadFailed'));
        } finally {
            if (current === seq) busy.value = false;
        }
    }, 220);
});

onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
});

watch(open, async (value) => {
    if (!value) return;
    keyword.value = '';
    result.value = null;
    failed.value = '';
    highlight.value = 0;
    await nextTick();
    inputRef.value?.focus();
});

function close() {
    open.value = false;
}

/** 布局侧栏的入口按钮走这个方法，而不是让父级直接改组件状态 */
function openPalette() {
    open.value = true;
}

function move(delta: number) {
    const total = items.value.length;
    if (!total) return;
    highlight.value = (highlight.value + delta + total) % total;
    void nextTick(() => {
        listRef.value?.querySelectorAll<HTMLElement>('[data-palette-item]')[highlight.value]?.scrollIntoView({ block: 'nearest' });
    });
}

function onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        // 在输入框里也不放行：浏览器没有默认的 Ctrl+K 动作，而工作台的核心交互就是「随时能唤起面板」
        event.preventDefault();
        open.value = !open.value;
        return;
    }
    if (!open.value) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        close();
    } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        items.value[highlight.value]?.run();
    }
}

/** 面板打开时锁定背景滚动，关掉（含跨断点）一定复位 */
watch(open, (value) => {
    if (import.meta.client) document.body.style.overflow = value ? 'hidden' : '';
});
onBeforeUnmount(() => {
    if (import.meta.client) {
        document.removeEventListener('keydown', onKeydown);
        document.body.style.overflow = '';
    }
});
if (import.meta.client) document.addEventListener('keydown', onKeydown);

defineExpose({ openPalette, close });
</script>

<template>
    <Teleport to="body">
        <div v-if="open" class="app-modal-backdrop" @click.self="close">
            <!-- 宽度用 !w-[…]：theme.css 未分层，普通 w-* 工具类会被 .app-modal 的 width:100% 盖掉。
                 min(40rem,100%) 让 ≤640px 的底部抽屉形态仍然满宽，桌面拿到比默认 32rem 更宽的一栏。 -->
            <div class="app-modal !w-[min(40rem,100%)]" role="dialog" aria-modal="true" :aria-label="t('work.paletteTitle')">
                <div class="border-line flex items-center gap-2 border-b px-3 py-2.5">
                    <AppIcon name="magnify" :size="16" class="text-faint shrink-0" />
                    <input
                        v-model="keyword"
                        class="app-input min-w-0 flex-1 !border-0 !bg-transparent !px-0 !text-sm"
                        :placeholder="t('work.palettePlaceholder')"
                        :aria-label="t('work.palettePlaceholder')"
                    />
                    <AppIcon v-if="busy" name="autorenew" :size="14" class="text-faint shrink-0 animate-spin" />
                    <kbd class="text-faint hidden shrink-0 rounded border border-[color:var(--line)] px-1.5 py-0.5 text-[10px] sm:inline">{{
                        t('work.paletteEsc')
                    }}</kbd>
                </div>

                <p v-if="failed" class="app-help-error px-3 py-2">{{ failed }}</p>

                <div ref="listRef" class="min-h-0 flex-1 overflow-y-auto p-2">
                    <template v-for="(item, index) in items" :key="item.id">
                        <p v-if="index === 0 || items[index - 1]?.group !== item.group" class="text-faint px-2 pt-2 pb-1 text-[10px] font-bold uppercase">
                            {{ item.group }}
                        </p>
                        <button
                            type="button"
                            data-palette-item
                            class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors"
                            :class="highlight === index ? 'bg-[color:var(--surface-3)]' : 'hover:bg-[color:var(--surface-2)]'"
                            @mouseenter="highlight = index"
                            @click="item.run()"
                        >
                            <AppIcon :name="item.icon" :size="15" class="text-faint shrink-0" />
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-sm font-medium">{{ item.label }}</span>
                                <span v-if="item.sub" class="text-faint block truncate text-[11px]">{{ item.sub }}</span>
                            </span>
                            <span v-if="highlight === index" class="text-faint shrink-0 text-[10px]">{{ t('work.paletteEnter') }}</span>
                        </button>
                    </template>

                    <div v-if="!items.length" class="text-faint px-3 py-8 text-center text-xs">
                        {{ keyword.trim() ? t('work.paletteNoMatch') : t('work.paletteEmpty') }}
                    </div>
                </div>

                <div class="text-faint border-line flex items-center gap-3 border-t px-3 py-2 text-[10px]">
                    <!-- 键盘提示只在有键盘的形态下出现：窄屏（触屏）里 ↑↓/⏎ 是噪音 -->
                    <span class="hidden sm:inline">↑ ↓ {{ t('work.paletteNavigate') }}</span>
                    <span class="hidden sm:inline">⏎ {{ t('work.paletteSelect') }}</span>
                    <span class="ml-auto min-w-0 truncate">{{ route.path }}</span>
                </div>
            </div>
        </div>
    </Teleport>
</template>
