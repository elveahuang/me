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
 * 今日页：工作台的首页面板。
 *
 * 一次 `/api/overview` 拿到逾期、今天到期、未来 7 天日程、任务计数、最近笔记与当天简报，
 * 六个区块读的是同一时刻——分开发请求会出现「上面说还有 3 条逾期、下面清单是空的」。
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

// 快速添加：标题 + 一个日期档位。日期档位而不是自由文本解析——
// 「明天/这周末」的中文 NL 解析要引依赖，而档位选择器在窄屏上一次点击就能完成。
const quickTitle = ref('');
const quickDue = ref<'none' | 'today' | 'tomorrow' | 'week'>('today');
const quickPriority = ref<WorkTaskPriority>('medium');
const quickProject = ref('');
const quickSaving = ref(false);
const quickError = ref('');

const { success, flashSuccess } = useFlashSuccess();
const actionError = ref('');

const drawerOpen = ref(false);
const editing = ref<WorkTask | null>(null);
const saving = ref(false);

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

function openNew() {
    editing.value = null;
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
        await refresh();
    } catch (e) {
        briefError.value = extractApiError(e, t('work.briefFailed'));
    } finally {
        briefBusy.value = false;
    }
}

const stats = computed(() => {
    const counts = overview.value?.counts ?? {};
    return [
        { key: 'overdue', label: t('work.statOverdue'), value: overview.value?.overdue.length ?? 0, icon: 'alert-circle-outline', tone: 'danger' },
        { key: 'today', label: t('work.statDueToday'), value: overview.value?.dueToday.length ?? 0, icon: 'calendar-outline', tone: 'warning' },
        { key: 'open', label: t('work.statOpen'), value: (counts.todo ?? 0) + (counts.doing ?? 0), icon: 'view-list-outline', tone: 'info' },
        { key: 'done', label: t('work.statDone'), value: counts.done ?? 0, icon: 'check-circle-outline', tone: 'success' },
    ];
});

const briefTitle = computed(() => (overview.value?.brief ? formatDateTime(overview.value.brief.generatedAt) : ''));
</script>

<template>
    <div class="space-y-6">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title">{{ t('work.todayTitle') }}</h1>
                <p class="app-page-subtitle">{{ overview?.date ?? today }} · {{ t('work.todaySubtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <button type="button" class="app-btn app-btn-primary" @click="openNew">
                    <AppIcon name="plus" :size="16" />
                    <span>{{ t('work.newTask') }}</span>
                </button>
            </div>
        </div>

        <div v-if="loadFailed" class="app-alert app-alert-danger flex items-center gap-2">
            <AppIcon name="alert-outline" :size="16" />
            <span class="min-w-0 flex-1">{{ extractApiError(error, t('common.loadFailed')) }}</span>
            <button type="button" class="app-btn app-btn-soft !px-3 !py-1 !text-[10px]" @click="refresh()">{{ t('common.retry') }}</button>
        </div>
        <div v-if="actionError" class="app-alert app-alert-danger flex items-center gap-2">
            <AppIcon name="alert-outline" :size="16" />
            <span class="min-w-0 flex-1">{{ actionError }}</span>
            <button type="button" class="app-btn app-btn-ghost app-btn-icon !h-6 !w-6" :aria-label="t('common.close')" @click="actionError = ''">
                <AppIcon name="close" :size="13" />
            </button>
        </div>
        <div v-if="success" class="app-alert app-alert-success">
            <AppIcon name="check-circle-outline" :size="16" />
            <span>{{ success }}</span>
        </div>

        <!-- 快速添加：一行输入 + 档位，回车即建 -->
        <form class="app-card flex flex-wrap items-center gap-2 p-3" @submit.prevent="addQuickTask">
            <AppIcon name="plus-circle-outline" :size="18" class="text-faint shrink-0" />
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
            <select v-model="quickPriority" class="app-input !w-auto !text-xs" :aria-label="t('work.fieldPriority')">
                <option v-for="p in TASK_PRIORITIES" :key="p" :value="p">{{ priorityLabel(p, t) }}</option>
            </select>
            <select v-model="quickProject" class="app-input !w-auto max-w-[9rem] truncate !text-xs" :aria-label="t('work.fieldProject')">
                <option value="">{{ t('work.noProject') }}</option>
                <option v-for="p in projects ?? []" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <button type="submit" class="app-btn app-btn-primary !px-3" :disabled="quickSaving">
                <AppIcon name="plus" :size="15" />
                <span hidden class="sm:inline">{{ t('common.add') }}</span>
            </button>
        </form>
        <p v-if="quickError" class="app-help-error -mt-4">{{ quickError }}</p>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="s in stats" :key="s.key" class="app-stat">
                <span class="app-stat-icon"><AppIcon :name="s.icon" :size="16" /></span>
                <div>
                    <p class="app-stat-value">{{ pending ? '…' : s.value }}</p>
                    <p class="app-stat-label">{{ s.label }}</p>
                </div>
            </div>
        </div>

        <!-- 每日简报 -->
        <section class="app-card p-4 sm:p-5">
            <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-sm font-black"><AppIcon name="newspaper-variant-outline" :size="15" class="mr-1 inline" />{{ t('work.brief') }}</h2>
                <span v-if="overview?.brief" class="text-faint text-[11px]">{{ briefTitle }}</span>
                <button type="button" class="app-btn app-btn-soft ml-auto !px-3 !py-1 !text-[11px]" :disabled="briefBusy" @click="generateBrief">
                    <AppIcon :name="briefBusy ? 'autorenew' : 'creation-outline'" :size="13" :class="briefBusy ? 'animate-spin' : ''" />
                    <span>{{ briefBusy ? t('work.briefGenerating') : overview?.brief ? t('work.briefRegenerate') : t('work.briefGenerate') }}</span>
                </button>
            </div>
            <p v-if="briefError" class="app-help-error mt-2">{{ briefError }}</p>
            <MarkdownContent v-if="overview?.brief?.content" :value="overview.brief.content" class="mt-3" />
            <p v-else-if="!briefBusy" class="text-faint mt-3 text-xs">{{ t('work.briefEmpty') }}</p>
            <div v-else class="mt-3 space-y-2">
                <div class="app-skeleton h-4 w-2/3" />
                <div class="app-skeleton h-4 w-full" />
                <div class="app-skeleton h-4 w-4/5" />
            </div>
        </section>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section class="app-card p-4">
                <h2 class="mb-2 flex items-center gap-1.5 text-sm font-black">
                    <AppIcon name="alert-circle-outline" :size="15" class="text-[color:var(--danger)]" />
                    {{ t('work.overdue') }}
                    <span class="text-faint font-normal">({{ overview?.overdue.length ?? 0 }})</span>
                </h2>
                <ul v-if="overview?.overdue.length" class="space-y-2">
                    <WorkTaskRow
                        v-for="task in overview.overdue"
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
                <div v-else-if="pending" class="space-y-2">
                    <div v-for="i in 3" :key="i" class="app-skeleton h-12" />
                </div>
                <p v-else class="text-faint py-4 text-center text-xs">{{ t('work.noOverdue') }}</p>
            </section>

            <section class="app-card p-4">
                <h2 class="mb-2 flex items-center gap-1.5 text-sm font-black">
                    <AppIcon name="calendar-check-outline" :size="15" class="text-[color:var(--brand-500)]" />
                    {{ t('work.dueToday') }}
                    <span class="text-faint font-normal">({{ overview?.dueToday.length ?? 0 }})</span>
                </h2>
                <ul v-if="overview?.dueToday.length" class="space-y-2">
                    <WorkTaskRow
                        v-for="task in overview.dueToday"
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
                <div v-else-if="pending" class="space-y-2">
                    <div v-for="i in 3" :key="i" class="app-skeleton h-12" />
                </div>
                <p v-else class="text-faint py-4 text-center text-xs">{{ t('work.noDueToday') }}</p>
            </section>

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
                <p v-else-if="!pending" class="text-faint py-4 text-center text-xs">{{ t('work.noUpcoming') }}</p>
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
                <p v-else-if="!pending" class="text-faint py-4 text-center text-xs">{{ t('work.noNotes') }}</p>
            </section>
        </div>

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
