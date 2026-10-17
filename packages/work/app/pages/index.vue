<script setup lang="ts">
import { extractApiError, formatDateTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import {
    composeDueAt,
    priorityLabel,
    TASK_PRIORITIES,
    todayInputValue,
    type WorkOverview,
    type WorkProject,
    type WorkTask,
    type WorkTaskPriority,
} from '../utils/work';

/**
 * 今日（`/`）：工作台的首页面板。
 *
 * 一次 `/api/overview` 拿到逾期、今天到期、未来 7 天日程、任务计数、最近笔记与当天简报，
 * 六个区块读的是同一时刻——分开发请求会出现「上面说还有 3 条逾期、下面清单是空的」。
 *
 * 版式只按「要不要动手」分层，不按数据种类平铺：
 * 页头 → 一行概览 chip → 快捷添加 → 今天要做（逾期与今天到期是同一张卡里的两组）→ 日程与笔记 → 简报。
 * 新建任务在整页只有一个入口（快捷添加那一行），页头不再放第二颗绿色大按钮：
 * 两颗按钮语义还不一样（一颗开抽屉、一颗直接建），三个加号同屏时用户无法判断点哪个。
 * 概览数字降级成一行 chip 而不是四张卡：逾期/今天到期两个数就是下面清单标题里的同一个数，
 * 各占一张与清单同重量的卡，等于让摘要比正文更响。
 * 空掉的区块收成一行而不是整张卡：两个空态各占一屏三分之一时，真正要办的两条任务会被顶出首屏。
 *
 * 行内动作（完成 / 推迟）直接 PATCH 后刷新总览：本机数据量小，
 * 整块刷新比逐条本地改状态更可信（状态、计数、简报口径不会分叉）。
 */
const { t } = useI18n();

const today = todayInputValue();

const { data: overview, pending, error, refresh } = await useFetch<WorkOverview>('/api/overview', { lazy: true });
const { data: projects } = useFetch<WorkProject[]>('/api/projects', { query: { archived: 'active' }, lazy: true, default: () => [] });

const loadFailed = computed(() => !!error.value);
const projectMap = computed(() => new Map((projects.value ?? []).map((p) => [p.id, p])));

/** 快速添加：标题 + 日期档位摆在首屏，优先级与项目收进「更多选项」 */
const quickTitle = ref('');
const quickDue = ref<'none' | 'today' | 'tomorrow' | 'week'>('today');
const quickPriority = ref<WorkTaskPriority>('medium');
const quickProject = ref('');
const quickMore = ref(false);
const quickSaving = ref(false);
const quickError = ref('');

/** 收起「更多选项」后仍要把已选的值说出来，否则用户会以为刚才挑的项目没生效 */
const quickSummary = computed(() => {
    const chips: string[] = [];
    if (quickPriority.value !== 'medium') chips.push(priorityLabel(quickPriority.value, t));
    const project = quickProject.value ? projectMap.value.get(quickProject.value) : null;
    if (project) chips.push(project.name);
    return chips;
});

const { success, flashSuccess } = useFlashSuccess();
const actionError = ref('');

/**
 * 三条提示合并成一个槽位。
 *
 * 原先加载失败、操作失败、成功各占一行，同时出现时页面顶部被三块横幅塞满，
 * 而它们说的是同一件事（这一次操作成没成）。优先级：加载失败 > 操作失败 > 成功。
 */
const notice = computed(() => {
    if (loadFailed.value) return { tone: 'danger' as const, text: extractApiError(error.value, t('common.loadFailed')), retry: true, closable: false };
    if (actionError.value) return { tone: 'danger' as const, text: actionError.value, retry: false, closable: true };
    if (success.value) return { tone: 'success' as const, text: success.value, retry: false, closable: false };
    return null;
});

const drawerOpen = ref(false);
const editing = ref<WorkTask | null>(null);
const saving = ref(false);

const briefOpen = ref(false);
const briefBusy = ref(false);
const briefError = ref('');

async function addQuickTask() {
    const title = quickTitle.value.trim();
    if (!title) {
        quickError.value = t('common.required', { field: t('work.fieldTitle') });
        return;
    }
    quickError.value = '';
    quickSaving.value = true;
    try {
        const due =
            quickDue.value === 'none' ? null : composeDueAt(quickDue.value === 'today' ? today : quickDue.value === 'tomorrow' ? shiftDay(1) : shiftDay(7));
        await $fetch('/api/tasks', {
            method: 'POST',
            body: { title, dueAt: due ? due.toISOString() : null, priority: quickPriority.value, projectId: quickProject.value || null },
        });
        quickTitle.value = '';
        flashSuccess(t('work.taskAdded'));
        await refresh();
    } catch (e) {
        quickError.value = extractApiError(e, t('common.error'));
    } finally {
        quickSaving.value = false;
    }
}

function shiftDay(days: number): string {
    const date = new Date(`${today}T00:00:00`);
    date.setDate(date.getDate() + days);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function patchTask(task: WorkTask, patch: Record<string, unknown>, message: string) {
    try {
        await $fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: patch });
        flashSuccess(message);
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}

function toggleTask(task: WorkTask) {
    const done = task.status === 'done';
    return patchTask(task, { status: done ? 'todo' : 'done' }, done ? t('work.taskReopened') : t('work.taskDone'));
}

function snoozeTask(task: WorkTask, days: number) {
    const base = task.dueAt && Date.parse(task.dueAt) > Date.now() ? new Date(task.dueAt) : new Date(`${today}T00:00:00`);
    base.setDate(base.getDate() + days);
    return patchTask(task, { dueAt: base.toISOString() }, days === 1 ? t('work.snoozedTomorrow') : t('work.snoozedWeek'));
}

function openEdit(task: WorkTask) {
    editing.value = task;
    drawerOpen.value = true;
}

async function saveTask(payload: {
    id?: string;
    title: string;
    detail: string;
    status: WorkTask['status'];
    priority: WorkTask['priority'];
    projectId: string | null;
    dueAt: string | null;
}) {
    saving.value = true;
    try {
        if (payload.id) await $fetch(`/api/tasks/${encodeURIComponent(payload.id)}`, { method: 'PATCH', body: payload });
        else await $fetch('/api/tasks', { method: 'POST', body: payload });
        drawerOpen.value = false;
        flashSuccess(payload.id ? t('common.saved') : t('work.taskAdded'));
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    } finally {
        saving.value = false;
    }
}

async function removeTask(task: WorkTask) {
    if (!confirm(t('work.deleteTaskConfirm', { title: task.title }))) return;
    try {
        await $fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
        drawerOpen.value = false;
        flashSuccess(t('common.deleted'));
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}

async function generateBrief() {
    briefBusy.value = true;
    briefError.value = '';
    try {
        await $fetch('/api/briefs', { method: 'POST', body: { date: overview.value?.date ?? today, force: true } });
        flashSuccess(t('work.briefReady'));
        // 生成完就地展开：用户点的就是「给我看今天的简报」，收起着等于让人再点一次
        briefOpen.value = true;
        await refresh();
    } catch (e) {
        briefError.value = extractApiError(e, t('work.briefFailed'));
    } finally {
        briefBusy.value = false;
    }
}

const overdueTasks = computed(() => overview.value?.overdue ?? []);
const dueTodayTasks = computed(() => overview.value?.dueToday ?? []);
/** 两组都空才整块收成一行空态；只空一组时那一组的小标题直接不渲染 */
const hasTodayTasks = computed(() => overdueTasks.value.length + dueTodayTasks.value.length > 0);

/** 卡内两组：空的那组整组不渲染，所以「逾期在前」这条顺序只在它真的有内容时才成立 */
const todayGroups = computed(() =>
    [
        { key: 'overdue', title: t('work.overdue'), tasks: overdueTasks.value, danger: true },
        { key: 'today', title: t('work.dueToday'), tasks: dueTodayTasks.value, danger: false },
    ].filter((group) => group.tasks.length > 0),
);

/** 概览 chip：逾期与今天到期是下面清单标题里的同一个数，这里只补「未完成 / 已完成」两个增量 */
const stats = computed(() => {
    const counts = overview.value?.counts ?? {};
    return [
        { key: 'overdue', label: t('work.statOverdue'), value: overdueTasks.value.length, hot: overdueTasks.value.length > 0 },
        { key: 'today', label: t('work.statDueToday'), value: dueTodayTasks.value.length, hot: false },
        { key: 'open', label: t('work.statOpen'), value: (counts.todo ?? 0) + (counts.doing ?? 0), hot: false },
        { key: 'done', label: t('work.statDone'), value: counts.done ?? 0, hot: false },
    ];
});

const briefTitle = computed(() => (overview.value?.brief ? formatDateTime(overview.value.brief.generatedAt) : ''));
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('work.todayTitle') }}</h1>
                <p class="app-page-subtitle">{{ overview?.date ?? today }} · {{ t('work.todaySubtitle') }}</p>
            </div>
            <!-- 页头刻意不放按钮：新建只有快捷添加一条路径，抽屉留给编辑已有任务 -->
        </div>

        <!-- 单一提示槽：加载失败给重试，操作失败给关闭，成功自己会消失 -->
        <div
            v-if="notice"
            class="app-alert flex items-center gap-2"
            :class="notice.tone === 'danger' ? 'app-alert-danger' : 'app-alert-success'"
            :aria-live="notice.tone === 'danger' ? 'assertive' : 'polite'"
        >
            <AppIcon :name="notice.tone === 'danger' ? 'alert-outline' : 'check-circle-outline'" :size="16" class="shrink-0" />
            <span class="min-w-0 flex-1">{{ notice.text }}</span>
            <button v-if="notice.retry" type="button" class="app-btn app-btn-soft shrink-0 !px-3 !py-1 !text-[10px]" @click="refresh()">
                {{ t('common.retry') }}
            </button>
            <button
                v-if="notice.closable"
                type="button"
                class="app-btn app-btn-ghost app-btn-icon !h-6 !w-6 shrink-0"
                :aria-label="t('common.close')"
                @click="actionError = ''"
            >
                <AppIcon name="close" :size="13" />
            </button>
        </div>

        <!-- 概览：一行 chip 说完四个数，逾期不为 0 时才染成危险色 -->
        <div v-if="!loadFailed" class="flex flex-wrap items-center gap-1.5">
            <span v-for="s in stats" :key="s.key" class="app-chip" :class="s.hot ? '!text-[color:var(--danger)]' : ''">
                {{ s.label }}
                <b class="font-black">{{ pending && !overview ? '…' : s.value }}</b>
            </span>
        </div>

        <!-- 快速添加：整页唯一的新建入口。标题 + 日期档位就在首屏，回车即建；优先级与项目收在下面 -->
        <form class="app-card space-y-2 p-3" @submit.prevent="addQuickTask">
            <div class="flex flex-wrap items-center gap-2">
                <input
                    v-model="quickTitle"
                    class="app-input min-w-0 flex-1 !text-sm"
                    :placeholder="t('work.quickPlaceholder')"
                    :aria-label="t('work.newTask')"
                    maxlength="200"
                    :disabled="quickSaving"
                />
                <select v-model="quickDue" class="app-input !w-auto !text-xs" :aria-label="t('work.fieldDueDay')">
                    <option value="none">{{ t('work.dueNone') }}</option>
                    <option value="today">{{ t('work.dayToday') }}</option>
                    <option value="tomorrow">{{ t('work.dayTomorrow') }}</option>
                    <option value="week">{{ t('work.inDays', { n: 7 }) }}</option>
                </select>
                <button
                    type="button"
                    class="app-btn app-btn-ghost !px-2 !text-xs"
                    :class="quickMore ? 'app-btn-soft' : ''"
                    :aria-expanded="quickMore"
                    @click="quickMore = !quickMore"
                >
                    <AppIcon name="chevron-down" :size="14" :class="quickMore ? 'rotate-180' : ''" />
                    <span>{{ t('work.quickMore') }}</span>
                </button>
                <button type="submit" class="app-btn app-btn-primary shrink-0 !px-3.5 !text-xs" :disabled="quickSaving">
                    <span>{{ t('common.add') }}</span>
                </button>
            </div>

            <div v-if="quickMore" class="border-line flex flex-wrap items-center gap-2 border-t pt-2">
                <select v-model="quickPriority" class="app-input !w-auto !text-xs" :aria-label="t('work.fieldPriority')">
                    <option v-for="p in TASK_PRIORITIES" :key="p" :value="p">{{ priorityLabel(p, t) }}</option>
                </select>
                <select v-model="quickProject" class="app-input !w-auto max-w-[12rem] truncate !text-xs" :aria-label="t('work.fieldProject')">
                    <option value="">{{ t('work.noProject') }}</option>
                    <option v-for="p in projects ?? []" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
            </div>
            <!-- 收起时把已选值留在行内，不然「选了但看不见」会被读成没选 -->
            <div v-else-if="quickSummary.length" class="flex flex-wrap items-center gap-1.5">
                <span v-for="chip in quickSummary" :key="chip" class="app-chip">{{ chip }}</span>
            </div>
        </form>
        <p v-if="quickError" class="app-help-error -mt-3">{{ quickError }}</p>

        <!-- 今天要做：逾期与今天到期是同一件事的两段，合成一张卡；组内小标题只在有内容时出现 -->
        <section class="app-card p-4">
            <div class="mb-2 flex items-center gap-1.5">
                <h2 class="flex min-w-0 items-center gap-1.5 text-sm font-black">
                    <AppIcon name="check-all" :size="15" class="shrink-0 text-[color:var(--brand-500)]" />
                    {{ t('work.todayListTitle') }}
                    <span class="text-faint font-normal">({{ pending && !overview ? '…' : overdueTasks.length + dueTodayTasks.length }})</span>
                </h2>
                <NuxtLink to="/tasks" class="text-hover-muted ml-auto shrink-0 text-[11px]">{{ t('work.openTasks') }}</NuxtLink>
            </div>
            <div v-if="pending && !overview" class="space-y-2">
                <div v-for="i in 3" :key="i" class="app-skeleton h-12" />
            </div>
            <template v-else-if="todayGroups.length">
                <template v-for="(group, groupIndex) in todayGroups" :key="group.key">
                    <p
                        class="text-faint mb-1.5 flex items-center gap-1 text-[11px] font-bold"
                        :class="[groupIndex === 0 ? 'mt-0' : 'mt-4', group.danger ? '!text-[color:var(--danger)]' : '']"
                    >
                        <AppIcon v-if="group.danger" name="alert-circle-outline" :size="12" class="shrink-0" />
                        {{ group.title }} · {{ group.tasks.length }}
                    </p>
                    <ul class="space-y-2">
                        <WorkTaskRow
                            v-for="task in group.tasks"
                            :key="task.id"
                            :task="task"
                            :today="today"
                            :project-name="task.projectId ? projectMap.get(task.projectId)?.name : ''"
                            :project-color="task.projectId ? projectMap.get(task.projectId)?.color : ''"
                            @toggle="toggleTask"
                            @edit="openEdit"
                            @snooze="snoozeTask"
                        />
                    </ul>
                </template>
            </template>
            <p v-else class="text-faint py-2 text-xs">{{ t('work.nothingDueToday') }}</p>
        </section>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section class="app-card p-4">
                <h2 class="mb-2 flex items-center gap-1.5 text-sm font-black">
                    <AppIcon name="clock-outline" :size="15" />
                    {{ t('work.upcomingEvents') }}
                    <NuxtLink to="/calendar" class="text-hover-muted ml-auto text-[11px]">{{ t('work.openCalendar') }}</NuxtLink>
                </h2>
                <ul v-if="overview?.upcomingEvents.length" class="space-y-2">
                    <li v-for="ev in overview.upcomingEvents" :key="ev.id" class="app-list-row">
                        <div class="min-w-0 flex-1">
                            <p class="truncate text-sm font-medium">{{ ev.title }}</p>
                            <p class="text-faint mt-1 text-[11px]">
                                {{ formatDateTime(ev.startsAt) }}<span v-if="ev.location"> · {{ ev.location }}</span>
                            </p>
                        </div>
                        <span v-if="ev.allDay" class="app-badge app-badge-neutral">{{ t('work.allDay') }}</span>
                    </li>
                </ul>
                <p v-else-if="!pending" class="text-faint py-2 text-xs">{{ t('work.noUpcoming') }}</p>
            </section>

            <section class="app-card p-4">
                <h2 class="mb-2 flex items-center gap-1.5 text-sm font-black">
                    <AppIcon name="book-open-page-variant-outline" :size="15" />
                    {{ t('work.recentNotes') }}
                    <NuxtLink to="/notes" class="text-hover-muted ml-auto text-[11px]">{{ t('work.openNotes') }}</NuxtLink>
                </h2>
                <ul v-if="overview?.recentNotes.length" class="space-y-2">
                    <li v-for="note in overview.recentNotes.slice(0, 6)" :key="note.id" class="app-list-row">
                        <NuxtLink :to="`/notes/${encodeURIComponent(note.id)}`" class="min-w-0 flex-1">
                            <p class="truncate text-sm font-medium">{{ note.title || t('work.untitledNote') }}</p>
                            <p class="text-faint mt-1 line-clamp-2 text-[11px]">{{ note.summary || note.excerpt }}</p>
                        </NuxtLink>
                        <span v-if="note.pinned" class="app-badge app-badge-info"><AppIcon name="pin-outline" :size="11" /></span>
                    </li>
                </ul>
                <p v-else-if="!pending" class="text-faint py-2 text-xs">{{ t('work.noNotes') }}</p>
            </section>
        </div>

        <!-- 每日简报：默认折起的一张读物，展开与否不改变上面的清单 -->
        <section class="app-card p-4 sm:p-5">
            <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-sm font-black">
                    <button type="button" class="flex min-w-0 items-center gap-1.5" :aria-expanded="briefOpen" @click="briefOpen = !briefOpen">
                        <AppIcon name="newspaper-variant-outline" :size="15" class="shrink-0" />
                        <span>{{ t('work.brief') }}</span>
                        <AppIcon name="chevron-down" :size="14" :class="briefOpen ? 'rotate-180' : ''" />
                    </button>
                </h2>
                <span v-if="overview?.brief" class="text-faint text-[11px]">{{ briefTitle }}</span>
                <button type="button" class="app-btn app-btn-soft ml-auto !px-3 !py-1 !text-[11px]" :disabled="briefBusy" @click="generateBrief">
                    <AppIcon :name="briefBusy ? 'autorenew' : 'creation-outline'" :size="13" :class="briefBusy ? 'animate-spin' : ''" />
                    <span>{{ briefBusy ? t('work.briefGenerating') : overview?.brief ? t('work.briefRegenerate') : t('work.briefGenerate') }}</span>
                </button>
            </div>
            <!-- 收起时不再额外解释一行：标题右侧的箭头方向就是展开/收起的状态 -->
            <template v-if="briefOpen">
                <p v-if="briefError" class="app-help-error mt-2">{{ briefError }}</p>
                <MarkdownContent v-if="overview?.brief?.content" :value="overview.brief.content" class="mt-3" />
                <p v-else-if="!briefBusy" class="text-faint mt-3 text-xs">{{ t('work.briefEmpty') }}</p>
                <div v-else class="mt-3 space-y-2">
                    <div class="app-skeleton h-4 w-2/3" />
                    <div class="app-skeleton h-4 w-full" />
                    <div class="app-skeleton h-4 w-4/5" />
                </div>
            </template>
        </section>

        <WorkTaskDrawer
            :open="drawerOpen"
            :task="editing"
            :projects="projects ?? []"
            :saving="saving"
            @close="drawerOpen = false"
            @save="saveTask"
            @remove="removeTask"
        />
    </div>
</template>
