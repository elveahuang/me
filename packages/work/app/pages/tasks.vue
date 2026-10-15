<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { priorityLabel, priorityTone, statusLabel, TASK_STATUSES, todayInputValue, type WorkProject, type WorkTask, type WorkTaskStatus } from '../utils/work';

/**
 * 任务页：筛选 + 列表 / 看板两种视图。
 *
 * 筛选条件全部写进 URL（`?status=&project=&q=&view=&sort=`）：
 * 工作台的使用方式是「早上看今天、下午看某个项目」，书签与命令面板深链都靠它，
 * 把条件只存在组件 ref 里会让「分享一个视图」变成不可能。
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const today = todayInputValue();

const statusFilter = ref<string>(typeof route.query.status === 'string' ? route.query.status : 'open');
const projectFilter = ref<string>(typeof route.query.project === 'string' ? route.query.project : '');
const view = ref<'list' | 'board'>(route.query.view === 'board' ? 'board' : 'list');
const sort = ref<string>(typeof route.query.sort === 'string' ? route.query.sort : 'due');
const keywordInput = ref<string>(typeof route.query.q === 'string' ? route.query.q : '');
const keyword = ref(keywordInput.value);

/** 输入防抖：任务列表是「边打字边筛」，不防抖的话每敲一个字发一次请求 */
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(keywordInput, (value) => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => (keyword.value = value.trim()), 300);
});
onBeforeUnmount(() => {
    if (searchTimer) clearTimeout(searchTimer);
});

const query = computed(() => ({
    status: statusFilter.value || undefined,
    projectId: projectFilter.value || undefined,
    keyword: keyword.value || undefined,
    order: sort.value === 'due' ? undefined : sort.value,
}));

const { data: tasks, pending, error, refresh } = await useFetch<WorkTask[]>('/api/tasks', { query, lazy: true, default: () => [] });
const { data: projects } = useFetch<WorkProject[]>('/api/projects', { lazy: true, default: () => [] });

const projectMap = computed(() => new Map((projects.value ?? []).map((p) => [p.id, p])));
const loadFailed = computed(() => !!error.value);
const actionError = ref('');

const { success, flashSuccess } = useFlashSuccess();

watch([statusFilter, projectFilter, view, sort, keyword], () => {
    router.replace({
        query: {
            ...route.query,
            status: statusFilter.value || undefined,
            project: projectFilter.value || undefined,
            view: view.value === 'list' ? undefined : view.value,
            sort: sort.value === 'due' ? undefined : sort.value,
            q: keyword.value || undefined,
        },
    });
});

const statusChips = computed(() => [
    { value: 'open', label: t('work.filterOpen') },
    { value: '', label: t('common.all') },
    ...TASK_STATUSES.map((s) => ({ value: s, label: statusLabel(s, t) })),
]);

const counts = computed(() => {
    const map = new Map<string, number>();
    for (const task of tasks.value ?? []) map.set(task.status, (map.get(task.status) ?? 0) + 1);
    return map;
});

const drawerOpen = ref(false);
const editing = ref<WorkTask | null>(null);
const saving = ref(false);

function openNew() {
    editing.value = null;
    drawerOpen.value = true;
}

function openEdit(task: WorkTask) {
    editing.value = task;
    drawerOpen.value = true;
}

/** 命令面板「新建任务」的深链：消费一次即清除，刷新不会重复弹抽屉（SSR 阶段不打开，见 calendar.vue 同段说明） */
onMounted(() => {
    if (route.query.new !== '1') return;
    openNew();
    void router.replace({ query: { ...route.query, new: undefined } });
});

async function saveTask(payload: {
    id?: string;
    title: string;
    detail: string;
    status: WorkTaskStatus;
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

async function patch(task: WorkTask, body: Record<string, unknown>, message: string) {
    try {
        await $fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body });
        flashSuccess(message);
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}

function toggle(task: WorkTask) {
    const done = task.status === 'done';
    return patch(task, { status: done ? 'todo' : 'done' }, done ? t('work.taskReopened') : t('work.taskDone'));
}

function snooze(task: WorkTask, days: number) {
    const base = task.dueAt && Date.parse(task.dueAt) > Date.now() ? new Date(task.dueAt) : new Date(`${today}T00:00:00`);
    base.setDate(base.getDate() + days);
    return patch(task, { dueAt: base.toISOString() }, days === 1 ? t('work.snoozedTomorrow') : t('work.snoozedWeek'));
}

/** 看板列间移动：按 TASK_STATUSES 的顺序左右挪一格，不引入拖拽库 */
function move(task: WorkTask, delta: number) {
    const index = TASK_STATUSES.indexOf(task.status);
    const next = TASK_STATUSES[Math.min(TASK_STATUSES.length - 1, Math.max(0, index + delta))];
    if (!next || next === task.status) return;
    return patch(task, { status: next }, t('work.taskMoved', { to: statusLabel(next, t) }));
}

async function remove(task: WorkTask) {
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

const boardColumns = computed(() => TASK_STATUSES.map((s) => ({ status: s, rows: (tasks.value ?? []).filter((task) => task.status === s) })));
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title">{{ t('work.tasksTitle') }}</h1>
                <p class="app-page-subtitle">{{ t('work.tasksSubtitle', { n: (tasks ?? []).length }) }}</p>
            </div>
            <div class="app-page-actions">
                <div class="app-segmented" role="group" :aria-label="t('work.viewMode')">
                    <button type="button" class="app-segmented-item" :aria-pressed="view === 'list'" @click="view = 'list'">
                        <AppIcon name="view-list-outline" :size="13" class="mr-1 inline" />{{ t('work.viewList') }}
                    </button>
                    <button type="button" class="app-segmented-item" :aria-pressed="view === 'board'" @click="view = 'board'">
                        <AppIcon name="dots-grid" :size="13" class="mr-1 inline" />{{ t('work.viewBoard') }}
                    </button>
                </div>
                <button type="button" class="app-btn app-btn-primary" @click="openNew">
                    <AppIcon name="plus" :size="16" />
                    <span>{{ t('work.newTask') }}</span>
                </button>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <div class="relative min-w-0 flex-1 sm:max-w-xs">
                <AppIcon name="magnify" :size="15" class="text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
                <input v-model="keywordInput" class="app-input !pl-8 !text-xs" :placeholder="t('work.searchTasks')" :aria-label="t('work.searchTasks')" />
            </div>
            <button
                v-for="chip in statusChips"
                :key="chip.value || 'all'"
                type="button"
                class="app-chip"
                :class="statusFilter === chip.value ? 'app-chip-brand' : ''"
                :aria-pressed="statusFilter === chip.value"
                @click="statusFilter = chip.value"
            >
                {{ chip.label }}
                <span v-if="chip.value && counts.get(chip.value)" class="ml-0.5 opacity-70">{{ counts.get(chip.value) }}</span>
            </button>
            <select v-model="projectFilter" class="app-input !w-auto max-w-[10rem] truncate !text-xs" :aria-label="t('work.fieldProject')">
                <option value="">{{ t('work.allProjects') }}</option>
                <option v-for="p in projects ?? []" :key="p.id" :value="p.id">{{ p.archived ? `(${t('work.archivedTag')}) ${p.name}` : p.name }}</option>
            </select>
            <select v-model="sort" class="app-input !w-auto !text-xs" :aria-label="t('work.sortBy')">
                <option value="due">{{ t('work.sortDue') }}</option>
                <option value="priority">{{ t('work.sortPriority') }}</option>
                <option value="created">{{ t('work.sortCreated') }}</option>
            </select>
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

        <div v-if="pending && !(tasks ?? []).length" class="space-y-2">
            <div v-for="i in 4" :key="i" class="app-skeleton h-16" />
        </div>

        <!-- 列表视图 -->
        <ul v-else-if="view === 'list'" class="space-y-2">
            <WorkTaskRow
                v-for="task in tasks ?? []"
                :key="task.id"
                :task="task"
                :today="today"
                :project-name="task.projectId ? projectMap.get(task.projectId)?.name : ''"
                :project-color="task.projectId ? projectMap.get(task.projectId)?.color : ''"
                @toggle="toggle"
                @edit="openEdit"
                @snooze="snooze"
            />
        </ul>
        <div v-if="view === 'list' && !(tasks ?? []).length && !loadFailed" class="app-empty">
            <AppIcon name="check-all" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ t('work.emptyTasks') }}</p>
            <p class="app-empty-desc">{{ t('work.emptyTasksHint') }}</p>
        </div>

        <!-- 看板视图 -->
        <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <section v-for="column in boardColumns" :key="column.status" class="app-panel flex min-h-[10rem] flex-col gap-2 p-3">
                <h2 class="flex items-center gap-1.5 text-xs font-black">
                    {{ statusLabel(column.status, t) }}
                    <span class="text-faint font-normal">{{ column.rows.length }}</span>
                </h2>
                <div v-for="task in column.rows" :key="task.id" class="app-card group space-y-1.5 p-3">
                    <button type="button" class="block w-full text-left text-sm font-medium" @click="openEdit(task)">
                        {{ task.title || t('work.untitledTask') }}
                    </button>
                    <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span class="app-badge" :class="priorityTone(task.priority)">{{ priorityLabel(task.priority, t) }}</span>
                        <span v-if="task.projectId && projectMap.get(task.projectId)" class="text-faint flex items-center gap-1 truncate">
                            <span
                                class="inline-block h-1.5 w-1.5 rounded-full"
                                :style="{ backgroundColor: projectMap.get(task.projectId)?.color || 'var(--muted-2)' }"
                            />
                            {{ projectMap.get(task.projectId)?.name }}
                        </span>
                    </div>
                    <div class="app-hover-reveal flex items-center gap-1 pt-1">
                        <button
                            type="button"
                            class="app-btn app-btn-ghost app-btn-icon app-btn-sm"
                            :disabled="TASK_STATUSES.indexOf(task.status) === 0"
                            :aria-label="t('work.moveBackward')"
                            @click="move(task, -1)"
                        >
                            <AppIcon name="chevron-left" :size="13" />
                        </button>
                        <button
                            type="button"
                            class="app-btn app-btn-ghost app-btn-icon app-btn-sm"
                            :disabled="TASK_STATUSES.indexOf(task.status) === TASK_STATUSES.length - 1"
                            :aria-label="t('work.moveForward')"
                            @click="move(task, 1)"
                        >
                            <AppIcon name="chevron-right" :size="13" />
                        </button>
                        <button
                            type="button"
                            class="app-btn app-btn-ghost app-btn-icon app-btn-sm ml-auto"
                            :aria-label="t('common.edit')"
                            @click="openEdit(task)"
                        >
                            <AppIcon name="pencil-outline" :size="13" />
                        </button>
                    </div>
                </div>
                <p v-if="!column.rows.length" class="text-faint py-4 text-center text-[11px]">{{ t('work.columnEmpty') }}</p>
            </section>
        </div>

        <WorkTaskDrawer
            :open="drawerOpen"
            :task="editing"
            :projects="projects ?? []"
            :saving="saving"
            @close="drawerOpen = false"
            @save="saveTask"
            @remove="remove"
        />
    </div>
</template>
