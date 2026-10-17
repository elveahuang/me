<script setup lang="ts">
import { extractApiError, formatDateTime, formatTime } from '@commons/contract';
import { useI18n } from 'vue-i18n';
import { relativeDayLabel, type WorkOverview } from '../utils/work';
import { todayInputValue } from '../utils/work-day';

/**
 * 今日（`/`）：工作台的首页面板。
 *
 * 一次 `/api/overview` 同时给出「今天要跑 / 今天已跑 / 未来 7 天 / 最近笔记 / 简报」，
 * 六块读的是同一时刻——分开发请求会出现「上面说还有 3 条要跑、下面清单是空的」。
 *
 * 版式仍按「要不要动手」分层：页头 → 一行概览 chip → 今天要跑（与今天已跑合在一张卡的两组）→
 * 后续安排与笔记 → 简报。三条刻意选择别退回：
 * - 页头不放按钮：这一页没有要新建的东西（定时任务在 `/tasks` 建），首屏只负责「今天该看什么」。
 * - 概览数字是一行 `.app-chip` 而不是四张 `.app-stat` 卡：数字就是下面清单标题里的同一个数，
 *   做成卡等于让摘要比正文更响。
 * - 空掉的区块收成一行而不是撑满一张居中空态：两个空态各占一屏三分之一时，真正要跑的会被顶出首屏。
 *
 * 「今天已跑」讲结果、「今天要跑」讲安排，同一条排期上午跑完后会同时出现在两组里，这是刻意的：
 * 用户 11 点打开时要能看出 09:00 那条跑过、且跑成什么样。
 */
const { t } = useI18n();

const today = todayInputValue();

const { data: overview, pending, error, refresh } = await useFetch<WorkOverview>('/api/overview', { lazy: true });

const loadFailed = computed(() => !!error.value);
const actionError = ref('');
const { success, flashSuccess } = useFlashSuccess();

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

const dueToday = computed(() => overview.value?.dueToday ?? []);
const runsToday = computed(() => overview.value?.runsToday ?? []);
const hasToday = computed(() => dueToday.value.length + runsToday.value.length > 0);

/**
 * 两组各自只在有内容时渲染，所以「要跑在前」这条顺序只在它真的有内容时才成立。
 *
 * 这里只迭代组名、行数据留在各自的 computed 上：`dueToday` 讲安排（`nextRunAt`）、`runsToday`
 * 讲结果（`lastStatus` / `lastConversationId`），字段完全不重叠。合成一个 `rows` 数组的话
 * 模板里 `v-if="group.key === 'due'"` 窄化不到 `row`（v-for 在 v-if 之前求值），
 * vue-tsc 只会看到联合类型，每一个字段访问都是 error。
 */
const todaySections = computed(() => (['due', 'ran'] as const).filter((key) => (key === 'due' ? dueToday.value.length : runsToday.value.length) > 0));

const stats = computed(() => {
    const counts = overview.value?.counts ?? { enabled: 0, paused: 0, failedToday: 0, notesToday: 0 };
    return [
        { key: 'due', label: t('work.statDueToday'), value: dueToday.value.length, hot: false },
        { key: 'failed', label: t('work.statFailedToday'), value: counts.failedToday, hot: counts.failedToday > 0 },
        { key: 'enabled', label: t('work.statEnabled'), value: counts.enabled, hot: false },
        { key: 'notes', label: t('work.statNotesToday'), value: counts.notesToday, hot: false },
    ];
});

const briefOpen = ref(false);
const briefBusy = ref(false);
const briefError = ref('');
const briefTitle = computed(() => (overview.value?.brief ? formatDateTime(overview.value.brief.generatedAt) : ''));

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

/**
 * 手动运行的在途标记。
 *
 * 接口是「立刻返回、结果落在库里」，所以真正的护栏是行上的 `lastStatus='running'`（服务端 409 兜底），
 * 但列表刷新前那一两秒界面还写着旧状态、按钮还能再点一次——没有这个 Set，双击就会先弹一条红横幅，
 * 用户读成「功能坏了」，而那其实只是他自己点得太快。与 `/tasks` 同一套写法。
 */
const running = ref<Set<string>>(new Set());

/**
 * 有轮在跑时补一次自动刷新。
 *
 * 结果是写进库里的，接口立刻返回时那一轮才刚开始；没有这个轮询，用户点了「立即运行」就得自己反复刷新
 * 才知道跑完了没有——而今日页正是「跑得怎么样」那一屏。只在确实有在跑的行时开着，跑完自动停。
 */
const hasRunning = computed(() => running.value.size > 0 || (overview.value?.runsToday ?? []).some((row) => row.lastStatus === 'running'));
let runPollTimer: ReturnType<typeof setInterval> | null = null;

function syncRunPoll(on: boolean) {
    if (runPollTimer) {
        clearInterval(runPollTimer);
        runPollTimer = null;
    }
    if (on) runPollTimer = setInterval(() => void refresh(), 10_000);
}

// 只在客户端挂：SSR 阶段没有卸载钩子，`immediate` 起来的那个 interval 会跟着每个请求漏在进程里
if (import.meta.client) watch(hasRunning, syncRunPoll, { immediate: true });

onBeforeUnmount(() => {
    if (runPollTimer) clearInterval(runPollTimer);
});

async function runNow(id: string) {
    if (running.value.has(id)) return;
    actionError.value = '';
    running.value = new Set(running.value).add(id);
    try {
        await $fetch(`/api/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' });
        flashSuccess(t('work.scheduleRunQueued'));
        await refresh();
    } catch (e) {
        actionError.value = extractApiError(e, t('common.error'));
    } finally {
        const next = new Set(running.value);
        next.delete(id);
        running.value = next;
    }
}
</script>

<template>
    <div class="space-y-5">
        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('work.todayTitle') }}</h1>
                <p class="app-page-subtitle">{{ overview?.date ?? today }} · {{ t('work.todaySubtitle') }}</p>
            </div>
            <div class="app-page-actions">
                <NuxtLink to="/tasks" class="app-btn app-btn-outline !px-3 !py-1.5 !text-xs">
                    <AppIcon name="timer-outline" :size="14" />
                    <span>{{ t('work.openSchedules') }}</span>
                </NuxtLink>
            </div>
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

        <!-- 概览：一行 chip 说完四个数，只有「今天失败」不为 0 时才染危险色 -->
        <div v-if="!loadFailed" class="flex flex-wrap items-center gap-1.5">
            <span v-for="s in stats" :key="s.key" class="app-chip" :class="s.hot ? '!text-[color:var(--danger)]' : ''">
                {{ s.label }}
                <b class="font-black">{{ pending && !overview ? '…' : s.value }}</b>
            </span>
        </div>

        <section class="app-card p-4">
            <div class="mb-2 flex items-center gap-1.5">
                <h2 class="flex min-w-0 items-center gap-1.5 text-sm font-black">
                    <AppIcon name="timer-outline" :size="15" class="shrink-0 text-[color:var(--brand-500)]" />
                    {{ t('work.todayRunTitle') }}
                    <span class="text-faint font-normal">({{ pending && !overview ? '…' : dueToday.length + runsToday.length }})</span>
                </h2>
                <NuxtLink to="/tasks?new=1" class="text-hover-muted ml-auto shrink-0 text-[11px]">{{ t('work.newSchedule') }}</NuxtLink>
            </div>

            <div v-if="pending && !overview" class="space-y-2">
                <div v-for="i in 3" :key="i" class="app-skeleton h-12" />
            </div>

            <template v-else-if="hasToday">
                <template v-for="(section, groupIndex) in todaySections" :key="section">
                    <p class="text-faint mb-1.5 text-[11px] font-bold" :class="groupIndex === 0 ? 'mt-0' : 'mt-4'">
                        {{ section === 'due' ? t('work.runsTodayDue') : t('work.runsTodayDone') }} ·
                        {{ section === 'due' ? dueToday.length : runsToday.length }}
                    </p>

                    <!-- 今天要跑：钟点在左，一行说完「什么时候、跑什么」，右侧就地手动运行 -->
                    <ul v-if="section === 'due'" class="space-y-2">
                        <li v-for="row in dueToday" :key="row.id" class="app-list-row">
                            <span class="text-brand w-14 shrink-0 font-mono text-xs">{{ formatTime(row.nextRunAt) }}</span>
                            <div class="min-w-0 flex-1">
                                <NuxtLink :to="`/tasks?id=${encodeURIComponent(row.id)}`" class="block truncate text-sm font-medium">
                                    {{ row.title }}
                                </NuxtLink>
                            </div>
                            <span class="text-faint shrink-0 text-[11px]">{{ relativeDayLabel(row.nextRunAt, today, t, formatDateTime) }}</span>
                            <button
                                type="button"
                                class="app-btn app-btn-ghost app-btn-icon app-btn-sm shrink-0"
                                :aria-label="t('work.runNow')"
                                :title="t('work.runNow')"
                                :disabled="running.has(row.id)"
                                @click="runNow(row.id)"
                            >
                                <AppIcon name="play-circle-outline" :size="15" />
                            </button>
                        </li>
                    </ul>

                    <!-- 今天已跑：结果是重点，失败时把原因与那条会话一起递出去；正在跑的那一轮也要占一行（见 /api/overview） -->
                    <ul v-else class="space-y-2">
                        <li v-for="row in runsToday" :key="row.id" class="app-list-row">
                            <span
                                class="inline-block h-2 w-2 shrink-0 rounded-full"
                                :class="
                                    row.lastStatus === 'success'
                                        ? 'bg-[color:var(--success)]'
                                        : row.lastStatus === 'running'
                                          ? 'animate-pulse bg-[color:var(--brand-500)]'
                                          : 'bg-[color:var(--danger)]'
                                "
                            />
                            <div class="min-w-0 flex-1">
                                <p class="truncate text-sm font-medium">{{ row.title }}</p>
                                <p v-if="row.lastStatus === 'failed' && row.lastError" class="mt-0.5 line-clamp-2 text-[11px] text-[color:var(--danger)]">
                                    {{ row.lastError }}
                                </p>
                            </div>
                            <span v-if="row.lastStatus === 'running'" class="app-badge app-badge-info shrink-0">{{ t('work.statusRunning') }}</span>
                            <span class="text-faint shrink-0 text-[11px]">{{ row.lastRunAt ? formatDateTime(row.lastRunAt) : '' }}</span>
                            <NuxtLink
                                v-if="row.lastConversationId"
                                :to="`/chat/${encodeURIComponent(row.agentId)}?c=${encodeURIComponent(row.lastConversationId)}`"
                                class="app-btn app-btn-soft app-btn-sm shrink-0 !px-2.5 !text-[10px]"
                            >
                                {{ t('work.openRunResult') }}
                            </NuxtLink>
                        </li>
                    </ul>
                </template>
            </template>
            <p v-else-if="!pending" class="text-faint py-2 text-xs">{{ t('work.nothingDueToday') }}</p>
        </section>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section class="app-card p-4">
                <h2 class="mb-2 flex items-center gap-1.5 text-sm font-black">
                    <AppIcon name="clock-outline" :size="15" />
                    {{ t('work.upcomingSchedules') }}
                    <NuxtLink to="/tasks" class="text-hover-muted ml-auto text-[11px]">{{ t('work.openSchedules') }}</NuxtLink>
                </h2>
                <ul v-if="overview?.upcoming.length" class="space-y-2">
                    <li v-for="row in overview.upcoming" :key="row.id" class="app-list-row">
                        <div class="min-w-0 flex-1">
                            <p class="truncate text-sm font-medium">{{ row.title }}</p>
                            <p class="text-faint mt-1 text-[11px]">{{ formatDateTime(row.nextRunAt) }}</p>
                        </div>
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
                            <p class="text-faint mt-1 line-clamp-2 text-[11px]">{{ note.excerpt }}</p>
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
    </div>
</template>
