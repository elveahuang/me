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
            reminderAt: string | null;
        },
    ): void;
    (e: 'remove', event: WorkEvent): void;
}>();

const { t } = useI18n();

/** 提醒预设（提前多少分钟）。库里存的是绝对时刻，这些只是常用档位；对不上的原值走「自定义」保留 */
const REMINDER_PRESETS = [5, 15, 60, 1440] as const;
type ReminderPreset = (typeof REMINDER_PRESETS)[number];
const REMINDER_LABELS: Record<ReminderPreset, string> = { 5: 'work.remind5', 15: 'work.remind15', 60: 'work.remind60', 1440: 'work.remind1440' };

const title = ref('');
const detail = ref('');
const startDate = ref('');
const startTime = ref('');
const endDate = ref('');
const endTime = ref('');
const allDay = ref(false);
const location = ref('');
const projectId = ref('');
const reminderChoice = ref('');
const error = ref('');
const titleInput = ref<HTMLInputElement | null>(null);
/** 编辑对象原本的提醒时刻与提前量；「自定义」档位按提前量对新开始时间反算（见 reminderValue） */
let originalReminderAt: string | null = null;
let originalReminderOffsetMin: number | null = null;

/** 回填：与 startsAt 恰好差某个预设分钟数就选中该档，否则算「自定义」——不能因为读不出档位就把用户设好的提醒清掉 */
function reminderChoiceFor(item: WorkEvent | null): string {
    if (!item?.reminderAt) return '';
    const minutes = reminderOffsetMinutes(item);
    return minutes !== null && REMINDER_PRESETS.includes(minutes as (typeof REMINDER_PRESETS)[number]) ? String(minutes) : 'custom';
}

/** 这条日程原本的「提前多少分钟」；提醒或开始时间读不出来时回 null */
function reminderOffsetMinutes(item: WorkEvent | null): number | null {
    const start = Date.parse(item?.startsAt ?? '');
    const moment = Date.parse(item?.reminderAt ?? '');
    if (Number.isNaN(start) || Number.isNaN(moment)) return null;
    return Math.round((start - moment) / 60_000);
}

/** 提醒按「这次最终确定的开始时间」重算：改了时间还留着旧提醒，就会提醒到昨天 */
function reminderValue(starts: Date): string | null {
    if (reminderChoice.value === '') return null;
    if (reminderChoice.value === 'custom') {
        // 自定义档位（智能体建的 7/10/30/90 分钟都落在这里，因为它对不上任何预设）同样只带走「提前量」，
        // 原样回传那个绝对时刻的话，把日程挪到明天，提醒就永远停在昨天那一分钟——
        // 而轮询有「迟到超过 5 分钟不再提示」的闸门（useEventReminders），结果是这条提醒永远不再弹，
        // 界面上的铃铛却还挂着，用户以为设过就有效。算不出提前量时才退回原值，至少不动用户设好的时刻。
        if (originalReminderOffsetMin === null) return originalReminderAt;
        return new Date(starts.getTime() - originalReminderOffsetMin * 60_000).toISOString();
    }
    return new Date(starts.getTime() - Number(reminderChoice.value) * 60_000).toISOString();
}

watch(allDay, (on) => {
    // 全天日程没有「几点」，偏移量算出来会落到前一天夜里，不如不设
    if (on) reminderChoice.value = '';
});

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
        originalReminderAt = item?.reminderAt ?? null;
        originalReminderOffsetMin = reminderOffsetMinutes(item);
        reminderChoice.value = allDay.value ? '' : reminderChoiceFor(item);
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
        reminderAt: reminderValue(starts),
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
                <p class="app-label">{{ t('work.fieldReminder') }}</p>
                <div class="flex flex-wrap items-center gap-1.5" role="group" :aria-label="t('work.fieldReminder')">
                    <AppIcon name="bell-outline" :size="14" class="text-faint" />
                    <button
                        type="button"
                        class="app-chip"
                        :class="reminderChoice === '' ? 'app-chip-brand' : ''"
                        :aria-pressed="reminderChoice === ''"
                        :disabled="allDay"
                        @click="reminderChoice = ''"
                    >
                        {{ t('work.remindNone') }}
                    </button>
                    <button
                        v-for="minutes in REMINDER_PRESETS"
                        :key="minutes"
                        type="button"
                        class="app-chip"
                        :class="reminderChoice === String(minutes) ? 'app-chip-brand' : ''"
                        :aria-pressed="reminderChoice === String(minutes)"
                        :disabled="allDay"
                        @click="reminderChoice = String(minutes)"
                    >
                        {{ t(REMINDER_LABELS[minutes]) }}
                    </button>
                    <button v-if="reminderChoice === 'custom'" type="button" class="app-chip app-chip-brand" aria-pressed="true" :disabled="allDay">
                        {{ t('work.remindCustom') }}
                    </button>
                </div>
                <p v-if="allDay" class="text-faint mt-1 text-[11px]">{{ t('work.remindAllDayHint') }}</p>
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
