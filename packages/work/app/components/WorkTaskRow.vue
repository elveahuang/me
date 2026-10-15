<script setup lang="ts">
import { formatDate, formatTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { priorityLabel, priorityTone, relativeDayLabel, statusLabel, statusTone, type WorkTask } from '../utils/work';

/**
 * 任务行：Today 页与任务页共用一套完成/改期交互。
 *
 * 刻意不做成「整行可点」的按钮：行内有勾选、改期、编辑三个动作，
 * 整行再包一层 button 会产生嵌套交互元素（键盘用户会读到三层 Tab）。
 */
const props = defineProps<{ task: WorkTask; today: string; projectName?: string; projectColor?: string }>();
const emit = defineEmits<{ (e: 'toggle', task: WorkTask): void; (e: 'edit', task: WorkTask): void; (e: 'snooze', task: WorkTask, days: number): void }>();

const { t } = useI18n();

const done = computed(() => props.task.status === 'done' || props.task.status === 'cancelled');
const overdue = computed(() => !done.value && !!props.task.dueAt && Date.parse(props.task.dueAt) < Date.now());
const dueLabel = computed(() => (props.task.dueAt ? relativeDayLabel(props.task.dueAt, props.today, t, formatDate) : ''));
const timeLabel = computed(() => (props.task.dueAt && !done.value ? formatTime(props.task.dueAt) : ''));
</script>

<template>
    <li class="app-list-row group" :class="done ? 'opacity-60' : ''">
        <button
            type="button"
            class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors"
            :class="
                done
                    ? 'border-transparent bg-[color:var(--success)] text-white'
                    : 'border-[color:var(--line)] text-transparent hover:border-[color:var(--brand-500)] hover:text-[color:var(--brand-500)]'
            "
            :aria-label="done ? t('work.reopen') : t('work.markDone')"
            :aria-pressed="done"
            @click="emit('toggle', task)"
        >
            <AppIcon name="check" :size="13" />
        </button>

        <div class="min-w-0 flex-1">
            <button type="button" class="block w-full truncate text-left text-sm font-medium" :class="done ? 'line-through' : ''" @click="emit('edit', task)">
                {{ task.title || t('work.untitledTask') }}
            </button>
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                <span v-if="projectName" class="text-faint flex items-center gap-1 truncate">
                    <span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: projectColor || 'var(--muted-2)' }" />
                    {{ projectName }}
                </span>
                <span v-if="dueLabel" class="flex items-center gap-1" :class="overdue ? 'font-bold text-[color:var(--danger)]' : 'text-faint'">
                    <AppIcon name="calendar-outline" :size="12" />
                    {{ dueLabel }}<span v-if="timeLabel"> · {{ timeLabel }}</span>
                </span>
                <span v-if="!done" class="app-badge" :class="priorityTone(task.priority)">{{ priorityLabel(task.priority, t) }}</span>
                <span v-else class="app-badge" :class="statusTone(task.status)">{{ statusLabel(task.status, t) }}</span>
                <span v-if="task.source === 'ai'" class="app-badge app-badge-info">{{ t('work.fromAi') }}</span>
            </div>
        </div>

        <div v-if="!done" class="app-table-actions app-hover-reveal flex shrink-0 items-center gap-1">
            <button
                v-for="days in [1, 7]"
                :key="days"
                type="button"
                class="app-btn app-btn-ghost app-btn-icon app-btn-sm"
                :title="days === 1 ? t('work.snoozeTomorrow') : t('work.snoozeWeek')"
                :aria-label="days === 1 ? t('work.snoozeTomorrow') : t('work.snoozeWeek')"
                @click="emit('snooze', task, days)"
            >
                <AppIcon :name="days === 1 ? 'clock-outline' : 'calendar-outline'" :size="14" />
            </button>
            <button type="button" class="app-btn app-btn-ghost app-btn-icon app-btn-sm" :aria-label="t('common.edit')" @click="emit('edit', task)">
                <AppIcon name="pencil-outline" :size="14" />
            </button>
        </div>
    </li>
</template>
