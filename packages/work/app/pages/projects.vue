<script setup lang="ts">
import { extractApiError } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { safeProjectColor, type WorkProject } from '../utils/work';

/**
 * 项目页：进度总览 + 归档 + 深链到该项目的任务/笔记/日程。
 *
 * 计数来自 `GET /api/projects?stats=1` 的服务端聚合，不在前端再拉一遍任务列表：
 * 项目页只要「每个项目多少条没做完」，把任务全量搬回浏览器再 filter 是本机数据里最贵的一种写法。
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const archiveFilter = ref<string>(route.query.archived === 'only' ? 'only' : route.query.archived === 'all' ? 'all' : 'active');
watch(archiveFilter, (next) => router.replace({ query: { ...route.query, archived: next === 'active' ? undefined : next } }));

const query = computed(() => ({ stats: '1', archived: archiveFilter.value }));
const { data: projects, pending, error, refresh } = await useFetch<WorkProject[]>('/api/projects', { query, lazy: true, default: () => [] });

const loadFailed = computed(() => !!error.value);
const actionError = ref('');
const { success, flashSuccess } = useFlashSuccess();

const drawerOpen = ref(false);
const editing = ref<WorkProject | null>(null);
const saving = ref(false);

function openNew() {
    editing.value = null;
    drawerOpen.value = true;
}

/** 命令面板「新建项目」的深链：消费一次即清除（SSR 阶段不开抽屉，见 calendar.vue 同段说明） */
onMounted(() => {
    if (route.query.new !== '1') return;
    openNew();
    void router.replace({ query: { ...route.query, new: undefined } });
});

function openEdit(project: WorkProject) {
    editing.value = project;
    drawerOpen.value = true;
}

async function saveProject(payload: { id?: string; name: string; description: string; color: string }) {
    saving.value = true;
    actionError.value = '';
    try {
        if (payload.id) await $fetch(`/api/projects/${encodeURIComponent(payload.id)}`, { method: 'PATCH', body: payload });
        else await $fetch('/api/projects', { method: 'POST', body: payload });
        drawerOpen.value = false;
        flashSuccess(payload.id ? t('common.saved') : t('work.projectAdded'));
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    } finally {
        saving.value = false;
    }
}

async function toggleArchived(project: WorkProject) {
    actionError.value = '';
    try {
        await $fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'PATCH', body: { archived: !project.archived } });
        flashSuccess(project.archived ? t('work.projectUnarchived') : t('work.projectArchived'));
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    }
}

async function removeProject(project: WorkProject) {
    if (!confirm(t('work.deleteProjectConfirm', { name: project.name }))) return;
    actionError.value = '';
    try {
        await $fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
        drawerOpen.value = false;
        flashSuccess(t('common.deleted'));
        await refresh();
    } catch (e) {
        // 服务端在「项目下还有任务/笔记/日程」时回 409 并带上计数文案，
        // 这里必须原样显示：折成「删除失败」用户就不知道自己该先移出去还是改用归档。
        actionError.value = extractApiError(e, t('common.error'));
    }
}

/** 完成率：只算未取消的任务，取消的不算「还没做完」 */
function progress(project: WorkProject): number {
    const total = (project.openTasks ?? 0) + (project.doneTasks ?? 0);
    return total ? Math.round(((project.doneTasks ?? 0) / total) * 100) : 0;
}

function goTasks(project: WorkProject) {
    router.push({ path: '/tasks', query: { project: project.id } });
}
function goNotes(project: WorkProject) {
    router.push({ path: '/notes', query: { project: project.id } });
}
function goCalendar(project: WorkProject) {
    router.push({ path: '/calendar', query: { project: project.id } });
}
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title">{{ t('work.projectsTitle') }}</h1>
                <p class="app-page-subtitle">{{ t('work.projectsSubtitle', { n: (projects ?? []).length }) }}</p>
            </div>
            <div class="app-page-actions">
                <div class="app-segmented" role="group" :aria-label="t('work.archiveFilter')">
                    <button type="button" class="app-segmented-item" :aria-pressed="archiveFilter === 'active'" @click="archiveFilter = 'active'">
                        {{ t('work.filterActive') }}
                    </button>
                    <button type="button" class="app-segmented-item" :aria-pressed="archiveFilter === 'archived'" @click="archiveFilter = 'only'">
                        {{ t('work.filterArchived') }}
                    </button>
                    <button type="button" class="app-segmented-item" :aria-pressed="archiveFilter === 'all'" @click="archiveFilter = 'all'">
                        {{ t('common.all') }}
                    </button>
                </div>
                <button type="button" class="app-btn app-btn-primary" @click="openNew">
                    <AppIcon name="plus" :size="16" />
                    <span>{{ t('work.newProject') }}</span>
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

        <div v-if="pending && !(projects ?? []).length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div v-for="i in 3" :key="i" class="app-skeleton h-40" />
        </div>

        <div v-else-if="(projects ?? []).length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <article v-for="project in projects ?? []" :key="project.id" class="app-card group flex flex-col gap-3 p-4">
                <div class="flex items-start gap-2">
                    <span class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: safeProjectColor(project.color) }" />
                    <button type="button" class="min-w-0 flex-1 text-left" @click="goTasks(project)">
                        <span class="block truncate text-sm font-black">{{ project.name }}</span>
                        <span v-if="project.description" class="text-faint mt-0.5 line-clamp-2 block text-[11px]">{{ project.description }}</span>
                    </button>
                    <span v-if="project.archived" class="app-badge app-badge-neutral shrink-0">{{ t('work.archivedTag') }}</span>
                </div>

                <div class="space-y-1.5">
                    <div class="flex items-center justify-between text-[11px]">
                        <span class="text-faint">{{
                            t('work.progressLabel', { done: project.doneTasks ?? 0, total: (project.openTasks ?? 0) + (project.doneTasks ?? 0) })
                        }}</span>
                        <span class="text-strong font-bold">{{ progress(project) }}%</span>
                    </div>
                    <div class="app-progress">
                        <div class="app-progress-bar" :style="{ width: `${progress(project)}%` }" />
                    </div>
                </div>

                <div class="text-faint flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    <span>{{ t('work.openCount', { n: project.openTasks ?? 0 }) }}</span>
                    <button type="button" class="app-link" @click="goNotes(project)">{{ t('work.noteCount', { n: project.noteCount ?? 0 }) }}</button>
                    <button type="button" class="app-link" @click="goCalendar(project)">{{ t('work.eventCount', { n: project.eventCount ?? 0 }) }}</button>
                </div>

                <div class="app-divider app-table-actions app-hover-reveal mt-auto flex items-center gap-2 pt-2 text-[11px]">
                    <button type="button" class="app-link" @click="openEdit(project)">{{ t('common.edit') }}</button>
                    <button type="button" class="app-link" @click="toggleArchived(project)">
                        {{ project.archived ? t('work.unarchive') : t('work.archive') }}
                    </button>
                    <button type="button" class="app-link ml-auto !text-[color:var(--danger)]" @click="removeProject(project)">{{ t('common.delete') }}</button>
                </div>
            </article>
        </div>

        <div v-else-if="!loadFailed" class="app-empty">
            <AppIcon name="folder-outline" :size="30" class="app-empty-icon" />
            <p class="app-empty-title">{{ t('work.emptyProjects') }}</p>
            <p class="app-empty-desc">{{ t('work.emptyProjectsHint') }}</p>
            <button type="button" class="app-btn app-btn-outline mt-2" @click="openNew">{{ t('work.newProject') }}</button>
        </div>

        <WorkProjectDrawer :open="drawerOpen" :project="editing" :saving="saving" @close="drawerOpen = false" @save="saveProject" @remove="removeProject" />
    </div>
</template>
