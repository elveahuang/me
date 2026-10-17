<script setup lang="ts">
import { extractApiError, formatDateTime, formatTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { dayInputValue, monthLabel, safeProjectColor, todayInputValue, type WorkEvent, type WorkProject } from '../utils/work';

/**
 * 日历页：月 / 周两种视图。
 *
 * 取数区间在网格可见范围两侧各放宽一天：服务端的 `from/to` 按北京日解释，
 * 而网格按本机日历切格，宿主时区不是 +08 时最外一圈的格子会差一天。
 * 放宽后分组仍按本机日，界面上不会出现「明明有日程却不在任何格子里」。
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

/** 视图选择写进 URL：日历是「回到上周」这种深链需求最强的页面，刷新后不该退回当月 */
const view = ref<'month' | 'week'>(route.query.view === 'week' ? 'week' : 'month');
watch(view, (next) => router.replace({ query: { ...route.query, view: next === 'week' ? 'week' : undefined } }));

const cursor = ref(anchorDate(route.query.day));
const projectFilter = ref(typeof route.query.project === 'string' ? route.query.project : '');
watch(projectFilter, (next) => router.replace({ query: { ...route.query, project: next || undefined } }));
const todayKey = todayInputValue();

/** 命令面板跳来的深链是 `?day=<ISO 日>`：无效值（非字符串、解析不出）一律回退到今天 */
function anchorDate(raw: unknown): Date {
    if (typeof raw !== 'string') return new Date();
    const parsed = new Date(`${raw}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function dayKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function shiftDay(day: string, days: number): string {
    const date = new Date(`${day}T00:00:00`);
    date.setDate(date.getDate() + days);
    return dayKey(date);
}

/** 本周起点（周一）：主流工作台把「工作周」当默认起点，周日排最后 */
function weekStart(date: Date): Date {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dow = (copy.getDay() + 6) % 7;
    copy.setDate(copy.getDate() - dow);
    return copy;
}

const grid = computed(() => {
    const anchor = cursor.value;
    if (view.value === 'week') {
        const start = weekStart(anchor);
        return WEEKDAYS.map((offset) => {
            const date = new Date(start);
            date.setDate(start.getDate() + offset);
            return date;
        });
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = weekStart(first);
    // 6 行 × 7 列恒等 42 格：跨月视图高度固定，切月不会让页面跳动
    return Array.from({ length: 42 }, (_, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        return date;
    });
});

const range = computed(() => {
    const days = grid.value.map((date) => dayKey(date));
    const first = days[0] ?? todayKey;
    const last = days[days.length - 1] ?? todayKey;
    return { from: shiftDay(first, -1), to: shiftDay(last, 1) };
});

const {
    data: events,
    pending,
    error,
    refresh,
} = await useFetch<WorkEvent[]>('/api/events', {
    query: computed(() => ({ from: range.value.from, to: range.value.to, includePast: '1', limit: '1000', projectId: projectFilter.value || undefined })),
    lazy: true,
    default: () => [],
});
const { data: projects } = useFetch<WorkProject[]>('/api/projects', { lazy: true, default: () => [] });
const projectMap = computed(() => new Map((projects.value ?? []).map((p) => [p.id, p])));

const byDay = computed(() => {
    const map = new Map<string, WorkEvent[]>();
    for (const event of events.value ?? []) {
        const key = dayInputValue(event.startsAt);
        if (!key) continue;
        const list = map.get(key) ?? [];
        list.push(event);
        map.set(key, list);
    }
    for (const list of map.values()) {
        list.sort((a, b) => {
            if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
            return Date.parse(a.startsAt) - Date.parse(b.startsAt);
        });
    }
    return map;
});

/**
 * 窄屏改用按天分组的清单：375px 宽的月网格每格只有约 50px，chip 连标题都放不下，
 * 「看不全的网格」不如「一条条读得完的清单」。数据仍来自同一个 `byDay`，
 * 区间也仍由当前视图（月/周）决定，所以切换视图在两种形态下含义一致。
 */
const agenda = computed(() => {
    const out: { day: string; dow: number; items: WorkEvent[] }[] = [];
    for (const date of grid.value) {
        const day = dayKey(date);
        const items = byDay.value.get(day);
        if (items?.length) out.push({ day, dow: date.getDay(), items });
    }
    return out;
});

const headerLabel = computed(() => {
    if (view.value === 'week') {
        const days = grid.value;
        const first = days[0];
        const last = days[days.length - 1];
        if (!first || !last) return '';
        return `${monthLabel(first.getFullYear(), first.getMonth(), locale.value)} ${first.getDate()} – ${last.getDate()}`;
    }
    return monthLabel(cursor.value.getFullYear(), cursor.value.getMonth(), locale.value);
});

function step(direction: number) {
    const anchor = cursor.value;
    cursor.value =
        view.value === 'week'
            ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + direction * 7)
            : new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

function goToday() {
    cursor.value = new Date();
}

const drawerOpen = ref(false);
const editing = ref<WorkEvent | null>(null);
const defaultDay = ref('');
const saving = ref(false);
const actionError = ref('');
const { success, flashSuccess } = useFlashSuccess();

function openNew(day: string) {
    editing.value = null;
    defaultDay.value = day;
    drawerOpen.value = true;
}

function openEdit(event: WorkEvent) {
    editing.value = event;
    defaultDay.value = '';
    drawerOpen.value = true;
}

/** 命令面板的「新建日程」用 `?new=1` 跳进来：消费一次就把标志清掉，避免刷新又弹一次抽屉。
 *  放在 mounted 而不是 setup 顶层：SSR 阶段就打开抽屉会让首屏 HTML 带一个不该存在的弹层。 */
function consumeNewFlag(): void {
    if (route.query.new !== '1') return;
    openNew(typeof route.query.day === 'string' ? route.query.day : todayKey);
    void router.replace({ query: { ...route.query, new: undefined } });
}

onMounted(consumeNewFlag);

/**
 * 深链要在「已经停在日历页」时也能生效：Nuxt 的默认 pageKey 只含路径（参数进、查询串不出），
 * 本页又没有自定义 pageKey，所以从提醒浮层或命令面板再跳一次 `/calendar?day=…` 只是换了换地址栏——
 * 组件不重建、`onMounted` 不再跑，日历纹丝不动，抽屉也不弹（`pages/chat/[agentId].vue` 的 `?c=` 已踩过同一个坑）。
 * 更糟的是取数区间是照着旧的 `cursor` 算的，用户连那一天有没有日程都看不到。
 */
watch(
    () => route.query.day,
    (raw) => {
        if (typeof raw === 'string') cursor.value = anchorDate(raw);
    },
);
watch(() => route.query.new, consumeNewFlag);

async function saveEvent(payload: {
    id?: string;
    title: string;
    detail: string;
    startsAt: string;
    endsAt: string | null;
    allDay: boolean;
    location: string;
    projectId: string | null;
    reminderAt: string | null;
}) {
    saving.value = true;
    actionError.value = '';
    try {
        if (payload.id) await $fetch(`/api/events/${encodeURIComponent(payload.id)}`, { method: 'PATCH', body: payload });
        else await $fetch('/api/events', { method: 'POST', body: payload });
        drawerOpen.value = false;
        flashSuccess(payload.id ? t('common.saved') : t('work.eventAdded'));
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    } finally {
        saving.value = false;
    }
}

async function removeEvent(event: WorkEvent) {
    if (!confirm(t('work.deleteEventConfirm', { title: event.title }))) return;
    saving.value = true;
    try {
        await $fetch(`/api/events/${encodeURIComponent(event.id)}`, { method: 'DELETE' });
        drawerOpen.value = false;
        flashSuccess(t('common.deleted'));
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    } finally {
        saving.value = false;
    }
}

const loadFailed = computed(() => !!error.value);

/** 月视图里把补白的上个月/下个月日子压暗；周视图整行都属于本周，不做 dim */
function isDimmed(date: Date): boolean {
    if (view.value !== 'month') return false;
    return date.getMonth() !== cursor.value.getMonth();
}
</script>

<template>
    <div class="space-y-4">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title">{{ t('work.calendarTitle') }}</h1>
                <p class="app-page-subtitle">{{ headerLabel }}</p>
            </div>
            <div class="app-page-actions flex flex-wrap items-center gap-2">
                <select v-model="projectFilter" class="app-input !w-auto max-w-[10rem] truncate !text-xs" :aria-label="t('work.fieldProject')">
                    <option value="">{{ t('work.allProjects') }}</option>
                    <option v-for="p in projects ?? []" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
                <div class="app-segmented" role="group" :aria-label="t('work.viewMode')">
                    <button type="button" class="app-segmented-item" :aria-pressed="view === 'month'" @click="view = 'month'">{{ t('work.viewMonth') }}</button>
                    <button type="button" class="app-segmented-item" :aria-pressed="view === 'week'" @click="view = 'week'">{{ t('work.viewWeek') }}</button>
                </div>
                <div class="flex items-center gap-1">
                    <button type="button" class="app-btn app-btn-ghost app-btn-icon" :aria-label="t('work.stepBack')" @click="step(-1)">
                        <AppIcon name="chevron-left" :size="16" />
                    </button>
                    <button type="button" class="app-btn app-btn-outline !px-3 !py-1.5 !text-[11px]" @click="goToday">{{ t('work.jumpToday') }}</button>
                    <button type="button" class="app-btn app-btn-ghost app-btn-icon" :aria-label="t('work.stepForward')" @click="step(1)">
                        <AppIcon name="chevron-right" :size="16" />
                    </button>
                </div>
                <button type="button" class="app-btn app-btn-primary" @click="openNew(todayKey)">
                    <AppIcon name="plus" :size="16" />
                    <span>{{ t('work.newEvent') }}</span>
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

        <div v-if="pending && !(events ?? []).length" class="app-skeleton h-[32rem]" />

        <template v-else>
            <div class="hidden grid-cols-7 gap-px overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--line)] sm:grid">
                <div v-for="dow in WEEKDAYS" :key="`h-${dow}`" class="text-faint bg-[color:var(--surface-2)] px-2 py-1.5 text-center text-[11px] font-bold">
                    {{ t(`work.weekday${dow}`) }}
                </div>
                <!--
                    格子本身是 div 而不是 button：否则「新建」按钮与日程 chip 会变成按钮套按钮，
                    键盘用户 Tab 到格子里的 chip 前会先停在整格上，回车永远只能新建。
                    现在日期号 = 新建，日程 chip = 编辑，两条路径各自可聚焦。
                -->
                <div
                    v-for="date in grid"
                    :key="dayKey(date)"
                    class="min-h-[7.5rem] bg-[color:var(--surface)] p-1.5 text-left transition-colors"
                    :class="[isDimmed(date) ? 'opacity-50' : '', dayKey(date) === todayKey ? 'ring-1 ring-[color:var(--brand-500)] ring-inset' : '']"
                >
                    <div class="flex items-center justify-between gap-1">
                        <button
                            type="button"
                            class="text-faint hover:text-brand rounded px-1 text-[11px] font-bold transition-colors"
                            :class="dayKey(date) === todayKey ? '!text-[color:var(--brand-500)]' : ''"
                            :aria-label="`${dayKey(date)} ${t('work.newEvent')}`"
                            @click="openNew(dayKey(date))"
                        >
                            {{ date.getDate() }}
                        </button>
                        <span v-if="view === 'month' && (byDay.get(dayKey(date)) ?? []).length > 3" class="text-faint pr-1 text-[10px]">
                            {{ t('work.moreEvents', { n: (byDay.get(dayKey(date)) ?? []).length }) }}
                        </span>
                    </div>
                    <ul class="mt-1 space-y-1">
                        <li v-for="event in (byDay.get(dayKey(date)) ?? []).slice(0, view === 'week' ? 12 : 3)" :key="event.id">
                            <button
                                type="button"
                                class="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] transition-opacity hover:opacity-80"
                                style="background-color: color-mix(in oklab, var(--brand-500) 14%, transparent)"
                                @click="openEdit(event)"
                            >
                                <span
                                    class="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                                    :style="{ backgroundColor: event.projectId ? safeProjectColor(projectMap.get(event.projectId)?.color) : 'var(--muted-2)' }"
                                />
                                <span v-if="!event.allDay" class="text-faint mr-1">{{ formatTime(event.startsAt) }}</span>
                                <span
                                    v-if="event.reminderAt"
                                    class="text-faint mr-1 inline-flex align-middle"
                                    :title="t('work.reminderAt', { time: formatDateTime(event.reminderAt, locale) })"
                                >
                                    <AppIcon name="bell-outline" :size="11" />
                                </span>
                                {{ event.title }}
                            </button>
                        </li>
                    </ul>
                </div>
            </div>

            <!-- 窄屏清单形态（网格在 < sm 隐藏）：点条目开编辑抽屉，点日期右侧加号在那天新建 -->
            <div class="space-y-3 sm:hidden">
                <section v-for="day in agenda" :key="day.day" class="app-card p-3">
                    <div class="mb-2 flex items-center gap-2">
                        <h2 class="text-strong text-xs font-black">{{ day.day }}</h2>
                        <span class="text-faint text-[11px]">{{ t(`work.weekday${day.dow}`) }}</span>
                        <span v-if="day.day === todayKey" class="app-chip app-chip-brand !px-1.5 !py-0 !text-[10px]">{{ t('work.dayToday') }}</span>
                        <button
                            type="button"
                            class="app-btn app-btn-ghost app-btn-icon ml-auto !h-7 !w-7"
                            :aria-label="t('work.newEvent')"
                            @click="openNew(day.day)"
                        >
                            <AppIcon name="plus" :size="14" />
                        </button>
                    </div>
                    <ul class="space-y-1.5">
                        <li v-for="event in day.items" :key="event.id">
                            <button type="button" class="app-list-row w-full text-left" @click="openEdit(event)">
                                <span
                                    class="h-2 w-2 shrink-0 rounded-full"
                                    :style="{ backgroundColor: event.projectId ? safeProjectColor(projectMap.get(event.projectId)?.color) : 'var(--muted-2)' }"
                                />
                                <span class="min-w-0 flex-1 truncate text-xs font-bold">{{ event.title }}</span>
                                <span
                                    v-if="event.reminderAt"
                                    class="text-faint shrink-0"
                                    :title="t('work.reminderAt', { time: formatDateTime(event.reminderAt, locale) })"
                                >
                                    <AppIcon name="bell-outline" :size="12" />
                                </span>
                                <span class="text-faint shrink-0 text-[11px]">{{ event.allDay ? t('work.allDay') : formatTime(event.startsAt) }}</span>
                            </button>
                        </li>
                    </ul>
                </section>
                <div v-if="!agenda.length" class="app-empty">
                    <AppIcon name="calendar-outline" :size="30" class="app-empty-icon" />
                    <p class="app-empty-title">{{ t('work.emptyAgenda') }}</p>
                    <p class="app-empty-desc">{{ t('work.emptyAgendaHint') }}</p>
                    <button type="button" class="app-btn app-btn-outline mt-2" @click="openNew(todayKey)">{{ t('work.newEvent') }}</button>
                </div>
            </div>

            <p class="text-faint hidden text-[11px] sm:block">{{ t('work.calendarHint') }}</p>
        </template>

        <WorkEventDrawer
            :open="drawerOpen"
            :event="editing"
            :projects="projects ?? []"
            :saving="saving"
            :default-day="defaultDay"
            :default-project-id="projectFilter"
            @close="drawerOpen = false"
            @save="saveEvent"
            @remove="removeEvent"
        />
    </div>
</template>
