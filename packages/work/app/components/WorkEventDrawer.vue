<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { dayInputValue, timeInputValue, type WorkEvent, type WorkProject } from '../utils/work';

/**
 * 日程编辑抽屉：新建与修改共用。
 *
 * 结束时间只在「晚于开始」时提交：`normalizeWorkDateRange` 对早于 startsAt 的值直接 400，
 * 与其让用户点保存后看一句报错，不如在这里就不发出去（留空即「没有结束时间」）。
 */
const props = defineProps<{
    open: boolean;
    event: WorkEvent | null;
    projects: WorkProject[];
    saving?: boolean;
    defaultDay?: string;
    defaultProjectId?: string;
}>();
const emit = defineEmits<{
    (e: 'close'): void;
    (
        e: 'save',
        payload: {
            id?: string;
            title: string;
            detail: string;
            startsAt: string;
            endsAt: string | null;
            allDay: boolean;
            location: string;
            projectId: string | null;
        },
    ): void;
    (e: 'remove', event: WorkEvent): void;
}>();

const { t } = useI18n();

const title = ref('');
const detail = ref('');
const startDate = ref('');
const startTime = ref('');
const endDate = ref('');
const endTime = ref('');
const allDay = ref(false);
const location = ref('');
const projectId = ref('');
const error = ref('');
const titleInput = ref<HTMLInputElement | null>(null);

watch(
    () => [props.open, props.event?.id] as const,
    ([open]) => {
        if (!open) return;
        const item = props.event;
        title.value = item?.title ?? '';
        detail.value = item?.detail ?? '';
        startDate.value = dayInputValue(item?.startsAt) || props.defaultDay || '';
        startTime.value = timeInputValue(item?.startsAt);
        endDate.value = dayInputValue(item?.endsAt);
        endTime.value = timeInputValue(item?.endsAt);
        allDay.value = item?.allDay ?? false;
        location.value = item?.location ?? '';
        // 新建时继承日历页当前选中的项目；编辑已有日程则以日程自身的归属为准
        projectId.value = item?.projectId ?? props.defaultProjectId ?? '';
        error.value = '';
        if (import.meta.client) void nextTick(() => titleInput.value?.focus());
    },
    { immediate: true },
);

/** 日期 + 时间 → 绝对时刻；时间留空按整天起点（00:00 本地）而不是 09:00：日程与待办的默认语义不同 */
function toMoment(day: string, time: string): Date | null {
    if (!day) return null;
    const base = new Date(`${day}T00:00:00`);
    if (Number.isNaN(base.getTime())) return null;
    const matched = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (matched) base.setHours(Number(matched[1]), Number(matched[2]), 0, 0);
    return base;
}

function submit() {
    if (!title.value.trim()) {
        error.value = t('common.required', { field: t('work.fieldTitle') });
        return;
    }
    const starts = toMoment(startDate.value, allDay.value ? '' : startTime.value);
    if (!starts) {
        error.value = t('work.needStart');
        return;
    }
    const ends = allDay.value ? null : toMoment(endDate.value || startDate.value, endTime.value);
    emit('save', {
        id: props.event?.id,
        title: title.value.trim(),
        detail: detail.value,
        startsAt: starts.toISOString(),
        endsAt: ends && ends.getTime() > starts.getTime() ? ends.toISOString() : null,
        allDay: allDay.value,
        location: location.value.trim(),
        projectId: projectId.value || null,
    });
}
</script>

<template>
    <AdminDrawer :open="open" :title="event ? t('work.editEvent') : t('work.newEvent')" width-class="sm:max-w-xl" @close="emit('close')">
        <div class="space-y-4">
            <div v-if="error" class="app-help-error">{{ error }}</div>

            <div>
                <label class="app-label" for="work-event-title">{{ t('work.fieldTitle') }}</label>
                <input
                    id="work-event-title"
                    ref="titleInput"
                    v-model="title"
                    class="app-input"
                    maxlength="200"
                    :placeholder="t('work.eventTitlePlaceholder')"
                />
            </div>

            <label class="app-checkbox flex items-center gap-2 text-xs font-medium">
                <input v-model="allDay" type="checkbox" class="app-input !h-4 !w-4" />
                <span>{{ t('work.fieldAllDay') }}</span>
            </label>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                    <label class="app-label" for="work-event-start-day">{{ t('work.fieldStarts') }}</label>
                    <input id="work-event-start-day" v-model="startDate" type="date" class="app-input" required />
                    <input v-model="startTime" type="time" class="app-input mt-2" :disabled="allDay" :aria-label="t('work.fieldStartTime')" />
                </div>
                <div>
                    <label class="app-label" for="work-event-end-day">{{ t('work.fieldEnds') }}</label>
                    <input id="work-event-end-day" v-model="endDate" type="date" class="app-input" :disabled="allDay" />
                    <input v-model="endTime" type="time" class="app-input mt-2" :disabled="allDay" :aria-label="t('work.fieldEndTime')" />
                </div>
            </div>

            <div>
                <label class="app-label" for="work-event-location">{{ t('work.fieldLocation') }}</label>
                <input id="work-event-location" v-model="location" class="app-input" maxlength="200" />
            </div>

            <div>
                <label class="app-label" for="work-event-project">{{ t('work.fieldProject') }}</label>
                <select id="work-event-project" v-model="projectId" class="app-input">
                    <option value="">{{ t('work.noProject') }}</option>
                    <option v-for="p in projects.filter((item) => !item.archived)" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
            </div>

            <div>
                <label class="app-label" for="work-event-detail">{{ t('work.fieldDetail') }}</label>
                <textarea id="work-event-detail" v-model="detail" rows="3" class="app-input" maxlength="4000" />
            </div>
        </div>

        <template #footer>
            <button v-if="event" type="button" class="app-btn app-btn-danger mr-auto" :disabled="saving" @click="emit('remove', event!)">
                {{ t('common.delete') }}
            </button>
            <button type="button" class="app-btn app-btn-outline" :disabled="saving" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button type="button" class="app-btn app-btn-primary" :disabled="saving" @click="submit">{{ t('common.save') }}</button>
        </template>
    </AdminDrawer>
</template>
