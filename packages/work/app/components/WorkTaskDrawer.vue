<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import {
    dayInputValue,
    priorityLabel,
    statusLabel,
    TASK_PRIORITIES,
    TASK_STATUSES,
    timeInputValue,
    type WorkProject,
    type WorkTask,
    type WorkTaskPriority,
    type WorkTaskStatus,
} from '../utils/work';

/**
 * 任务编辑抽屉：新建与修改共用。
 *
 * 表单状态在组件内，保存动作交给页面：抽屉不该知道 PATCH 还是 POST、
 * 也不该知道刷新哪一份列表（Today 与任务页的列表口径不同）。
 */
const props = defineProps<{ open: boolean; task: WorkTask | null; projects: WorkProject[]; saving?: boolean }>();
const emit = defineEmits<{
    (e: 'close'): void;
    (
        e: 'save',
        payload: {
            id?: string;
            title: string;
            detail: string;
            status: WorkTaskStatus;
            priority: WorkTaskPriority;
            projectId: string | null;
            dueAt: string | null;
        },
    ): void;
    (e: 'remove', task: WorkTask): void;
}>();

const { t } = useI18n();

const title = ref('');
const detail = ref('');
const status = ref<WorkTaskStatus>('todo');
const priority = ref<WorkTaskPriority>('medium');
const projectId = ref('');
const day = ref('');
const time = ref('');
const error = ref('');
const titleInput = ref<HTMLInputElement | null>(null);

watch(
    () => [props.open, props.task?.id] as const,
    ([open]) => {
        if (!open) return;
        const task = props.task;
        title.value = task?.title ?? '';
        detail.value = task?.detail ?? '';
        status.value = task?.status ?? 'todo';
        priority.value = task?.priority ?? 'medium';
        projectId.value = task?.projectId ?? '';
        day.value = dayInputValue(task?.dueAt);
        time.value = timeInputValue(task?.dueAt);
        error.value = '';
        // 抽屉里的首个字段是用户 90% 情况下唯一要填的：不自动聚焦的话，
        // 键盘用户每次都要先 Tab 五轮才能回到输入框
        if (import.meta.client) nextTick(() => titleInput.value?.focus());
    },
    { immediate: true },
);

function submit() {
    if (!title.value.trim()) {
        error.value = t('common.required', { field: t('work.fieldTitle') });
        return;
    }
    let dueAt: string | null = null;
    if (day.value) {
        const base = new Date(`${day.value}T00:00:00`);
        if (Number.isNaN(base.getTime())) {
            error.value = t('work.badDue');
            return;
        }
        const matched = /^(\d{1,2}):(\d{2})$/.exec(time.value.trim());
        if (matched) base.setHours(Number(matched[1]), Number(matched[2]), 0, 0);
        else base.setHours(9, 0, 0, 0);
        dueAt = base.toISOString();
    }
    emit('save', {
        id: props.task?.id,
        title: title.value.trim(),
        detail: detail.value,
        status: status.value,
        priority: priority.value,
        projectId: projectId.value || null,
        dueAt,
    });
}

const canDelete = computed(() => !!props.task);
</script>

<template>
    <AdminDrawer :open="open" :title="task ? t('work.editTask') : t('work.newTask')" width-class="sm:max-w-xl" @close="emit('close')">
        <div class="space-y-4">
            <div v-if="error" class="app-help-error">{{ error }}</div>

            <div>
                <label class="app-label" for="work-task-title">{{ t('work.fieldTitle') }}</label>
                <input id="work-task-title" ref="titleInput" v-model="title" class="app-input" maxlength="200" :placeholder="t('work.taskTitlePlaceholder')" />
            </div>

            <div>
                <label class="app-label" for="work-task-detail">{{ t('work.fieldDetail') }}</label>
                <textarea id="work-task-detail" v-model="detail" rows="4" class="app-input" maxlength="4000" :placeholder="t('work.taskDetailPlaceholder')" />
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label class="app-label" for="work-task-status">{{ t('work.fieldStatus') }}</label>
                    <select id="work-task-status" v-model="status" class="app-input">
                        <option v-for="s in TASK_STATUSES" :key="s" :value="s">{{ statusLabel(s, t) }}</option>
                    </select>
                </div>
                <div>
                    <label class="app-label" for="work-task-project">{{ t('work.fieldProject') }}</label>
                    <select id="work-task-project" v-model="projectId" class="app-input">
                        <option value="">{{ t('work.noProject') }}</option>
                        <option v-for="p in projects.filter((item) => !item.archived)" :key="p.id" :value="p.id">
                            {{ p.name }}
                        </option>
                    </select>
                </div>
            </div>

            <div>
                <span class="app-label">{{ t('work.fieldPriority') }}</span>
                <div class="app-segmented mt-1" role="group" :aria-label="t('work.fieldPriority')">
                    <button v-for="p in TASK_PRIORITIES" :key="p" type="button" class="app-segmented-item" :aria-pressed="priority === p" @click="priority = p">
                        {{ priorityLabel(p, t) }}
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label class="app-label" for="work-task-day">{{ t('work.fieldDueDay') }}</label>
                    <input id="work-task-day" v-model="day" type="date" class="app-input" />
                </div>
                <div>
                    <label class="app-label" for="work-task-time">{{ t('work.fieldDueTime') }}</label>
                    <input id="work-task-time" v-model="time" type="time" class="app-input" :disabled="!day" />
                </div>
            </div>
            <p class="text-faint text-[11px]">{{ t('work.dueHint') }}</p>
        </div>

        <template #footer>
            <button v-if="canDelete" type="button" class="app-btn app-btn-danger mr-auto" :disabled="saving" @click="task && emit('remove', task)">
                {{ t('common.delete') }}
            </button>
            <button type="button" class="app-btn app-btn-outline" :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button type="button" class="app-btn app-btn-primary" :disabled="saving" @click="submit">
                <AppIcon v-if="saving" name="autorenew" :size="15" class="animate-spin" />
                <span>{{ t('common.save') }}</span>
            </button>
        </template>
    </AdminDrawer>
</template>
