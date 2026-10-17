import { tool, type ToolSet } from 'ai';
import { and, asc, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import * as zod from 'zod';
import { SCHEDULE_KINDS, notes, schedules, type ScheduleKind } from '../db/schema';
import { db } from './db';
import { scheduleNoteIndex } from './note-index';
import { LOCAL_OWNER } from './owner';
import { likePattern, stringParam } from './query';
import { rateLimit } from './rate-limit';
import { resolveSchedulePlan } from './schedule-store';
import { shanghaiDateKey, shanghaiDayRange, shanghaiParts, shanghaiUpcomingEnd } from './work-day';
import { NOTE_CONTENT_MAX, WORK_TITLE_MAX, normalizeWorkDate, normalizeWorkOptionalText, normalizeWorkTags, normalizeWorkText } from './work-input';
import { SCHEDULE_PROMPT_MAX, describeSchedule, type SchedulePlan } from './work-schedule';

/**
 * 工作台内置工具：让任意智能体都能读写本机的工作台数据。
 *
 * 与 `buildToolSet()`（管理端配置的工具行）分开的理由：
 * 1. 这是本机的**私人事物**，不需要运营逐个绑定；用户说「帮我记个笔记」「每天九点跑一遍」时，
 *    答案不该取决于他选的这个智能体恰好挂了哪几行工具。
 * 2. 它们直接落到与 `/api/notes`、`/api/schedules` 同一批表、同一套入参归一，
 *    所以模型写入的行与用户在界面上手敲的行形状完全一致。
 * 3. 工具结果会进模型上下文，也可能进日志，因此一律输出「人读得懂的紧凑清单」，
 *    不外传正文全文、向量或供应商端点。
 *
 * 写侧一律带按次限流：work 唯一的门是 Origin 核验，本机进程发的请求一概放行，
 * 而模型在 agent 循环里可以连开 `maxSteps` 步，一次失控的提示就能刷出几十条记录。
 */

/** 工具结果进入模型上下文，条数与单条长度都要封顶：一次 `work_search` 打满 50 条笔记正文会把窗口挤爆。 */
const RESULT_ROWS_MAX = 20;
const RESULT_TEXT_MAX = 400;
/** 单次工具写入的预算：正常对话一轮最多调用一两次，阈值只为「模型自我循环」而存在。 */
const WRITE_LIMIT_PER_MIN = 20;

/** 排期清单里要读到的列：`describeSchedule` 要吃完整 plan，只给 `nextRunAt` 会描述成「每天 」。 */
type ScheduleLine = {
    id: string;
    title: string;
    kind: string;
    timeText: string;
    intervalMinutes: number | null;
    days: number[] | null;
    startsAt: Date;
    nextRunAt: Date;
    enabled: boolean;
};

function clip(value: string): string {
    const flat = value.replace(/\s+/g, ' ').trim();
    return flat.length > RESULT_TEXT_MAX ? `${flat.slice(0, RESULT_TEXT_MAX)}…` : flat;
}

function clockOf(value: Date): string {
    const p = shanghaiParts(value);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** 「今天」写成今天，其余写完整日期；只留 MM-DD 会让跨月的排期读起来像本周。 */
function formatWhen(value: Date): string {
    return shanghaiDateKey(value) === shanghaiDateKey(new Date()) ? '今天' : shanghaiDateKey(value);
}

function planOfLine(row: ScheduleLine): SchedulePlan {
    return {
        kind: row.kind as ScheduleKind,
        timeText: row.timeText,
        intervalMinutes: row.intervalMinutes,
        days: row.days ?? [],
        startsAt: row.startsAt,
    };
}

function scheduleLine(row: ScheduleLine): string {
    return `- [${row.id}] ${clip(row.title)}（${describeSchedule(planOfLine(row))}，下一次 ${formatWhen(row.nextRunAt)} ${clockOf(row.nextRunAt)}${row.enabled ? '' : '，已暂停'}）`;
}

/** 清单查询共用的列集合——漏一列就有一条描述变成空格，而且不会报错。 */
const scheduleColumns = {
    id: schedules.id,
    title: schedules.title,
    kind: schedules.kind,
    timeText: schedules.timeText,
    intervalMinutes: schedules.intervalMinutes,
    days: schedules.days,
    startsAt: schedules.startsAt,
    nextRunAt: schedules.nextRunAt,
    enabled: schedules.enabled,
};

/** 写侧统一闸门：键按动作分开，让「建了 20 条笔记」不影响「建一条排期」。 */
async function gateWrite(action: string): Promise<string | null> {
    const limited = await rateLimit(`workbench-${action}:${LOCAL_OWNER}`, WRITE_LIMIT_PER_MIN, 60_000);
    return limited.ok ? null : `操作过于频繁（每分钟最多 ${WRITE_LIMIT_PER_MIN} 次），请 ${limited.retryAfterSec} 秒后再试`;
}

/**
 * @param agentId 当前这一轮对话所属的智能体。`work_create_schedule` 把新排期挂在它名下——
 *   谁被要求安排就该由谁到点执行；让模型自己挑 agentId 只会多一个「它记错了 id」的失败面。
 */
export function buildWorkbenchTools(agentId: string): ToolSet {
    const set: Record<string, unknown> = {};

    set.work_today = tool({
        description: '读取工作台今日概览：今天要跑的定时任务、今天已跑出的结果、未来 7 天的安排、最近笔记。回答「今天有什么」「跑得怎么样」之前先调用它。',
        inputSchema: zod.object({}),
        execute: async () => {
            const now = new Date();
            const { start, end } = shanghaiDayRange(now);
            // 与今日页、简报同一份「未来 7 天」口径（见 work-day.ts 的 shanghaiUpcomingEnd）
            const weekEnd = shanghaiUpcomingEnd(end, 7);

            const [dueToday, runsToday, upcoming, recentNotes] = await Promise.all([
                db
                    .select(scheduleColumns)
                    .from(schedules)
                    .where(and(eq(schedules.enabled, true), gte(schedules.nextRunAt, start), lt(schedules.nextRunAt, end)))
                    .orderBy(asc(schedules.nextRunAt))
                    .limit(RESULT_ROWS_MAX),
                db
                    .select({
                        id: schedules.id,
                        title: schedules.title,
                        lastRunAt: schedules.lastRunAt,
                        lastStatus: schedules.lastStatus,
                        lastError: schedules.lastError,
                    })
                    .from(schedules)
                    .where(and(gte(schedules.lastRunAt, start), lt(schedules.lastRunAt, end), sql`${schedules.lastStatus} <> ''`))
                    .orderBy(desc(schedules.lastRunAt))
                    .limit(RESULT_ROWS_MAX),
                db
                    .select(scheduleColumns)
                    .from(schedules)
                    .where(and(eq(schedules.enabled, true), gte(schedules.nextRunAt, end), lt(schedules.nextRunAt, weekEnd)))
                    .orderBy(asc(schedules.nextRunAt))
                    .limit(RESULT_ROWS_MAX),
                db.select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt }).from(notes).orderBy(desc(notes.updatedAt)).limit(8),
            ]);

            const lines = [`今日（${shanghaiDateKey(now)}，北京时间）概览`];
            lines.push(`今天该跑的定时任务 ${dueToday.length} 条：\n${dueToday.map(scheduleLine).join('\n') || '无'}`);
            lines.push(
                `今天已跑 ${runsToday.length} 条：${
                    runsToday
                        .map(
                            (r) =>
                                `- ${clip(r.title)}（${clockOf(r.lastRunAt ?? now)} ${r.lastStatus === 'failed' ? `失败：${clip(r.lastError) || '未知原因'}` : r.lastStatus === 'running' ? '进行中' : '已跑出结果'}）`,
                        )
                        .join('\n') || '无'
                }`,
            );
            lines.push(`未来 7 天安排 ${upcoming.length} 条：\n${upcoming.map(scheduleLine).join('\n') || '无'}`);
            lines.push(`最近笔记：${recentNotes.map((n) => `${n.title || '无标题'}（${formatWhen(n.updatedAt)}）`).join('、') || '无'}`);
            return lines.join('\n');
        },
    });

    set.work_list_schedules = tool({
        description: '列出工作台定时任务。可用 keyword 过滤标题与正文，limit 控制条数（最多 50）。',
        inputSchema: zod.object({
            keyword: zod.string().optional().describe('标题或正文关键词'),
            limit: zod.number().optional().describe('返回条数，最多 50'),
        }),
        execute: async (input) => {
            const where: SQL[] = [];
            const keyword = stringParam(input.keyword, 128);
            if (keyword) where.push(or(ilike(schedules.title, likePattern(keyword)), ilike(schedules.prompt, likePattern(keyword)))!);
            const limit = Math.min(Math.max(Math.floor(Number(input.limit) || RESULT_ROWS_MAX), 1), 50);
            const rows = await db
                .select(scheduleColumns)
                .from(schedules)
                .where(where.length ? and(...where) : undefined)
                .orderBy(asc(schedules.nextRunAt))
                .limit(limit);
            if (!rows.length) return '没有符合条件的定时任务';
            return `${rows.length} 条定时任务：\n${rows.map(scheduleLine).join('\n')}`;
        },
    });

    set.work_create_schedule = tool({
        description:
            '新建一条定时任务：到点会自动跑当前这个智能体并把结果落成会话。kind 用 once/interval/daily/weekly；daily、weekly 给 time（HH:mm，北京时间），weekly 再给 days（0=周日…6=周六）；interval 给 intervalMinutes（5–10080）。startsAt 是首次执行的绝对时刻。',
        inputSchema: zod.object({
            title: zod.string().describe(`任务标题，最长 ${WORK_TITLE_MAX} 字`),
            prompt: zod.string().describe(`到点发给智能体的正文，最长 ${SCHEDULE_PROMPT_MAX} 字`),
            kind: zod.enum(SCHEDULE_KINDS).describe('once / interval / daily / weekly'),
            startsAt: zod.string().describe('首次执行时间，ISO 字符串或毫秒时间戳，如 2026-10-18T09:00:00+08:00'),
            time: zod.string().optional().describe('每天/每周的钟点 HH:mm（北京时间）'),
            days: zod.array(zod.number()).optional().describe('weekly 的星期数组，0=周日…6=周六'),
            intervalMinutes: zod.number().optional().describe('interval 的间隔分钟，5–10080'),
        }),
        execute: async (input) => {
            const blocked = await gateWrite('schedule');
            if (blocked) return blocked;
            let title: string;
            let prompt: string;
            let startsAt: Date | null;
            let resolved: { plan: SchedulePlan; nextRunAt: Date };
            try {
                title = normalizeWorkText(input.title, 'title', WORK_TITLE_MAX);
                prompt = normalizeWorkText(input.prompt, 'prompt', SCHEDULE_PROMPT_MAX);
                startsAt = normalizeWorkDate(input.startsAt, 'startsAt');
                if (!startsAt) return 'startsAt 必填';
                resolved = resolveSchedulePlan(
                    { kind: input.kind, time: input.time, intervalMinutes: input.intervalMinutes, days: input.days, startsAt },
                    new Date(),
                );
            } catch (error) {
                return `参数不合法：${(error as Error).message ?? String(error)}`;
            }
            const id = crypto.randomUUID();
            const { plan, nextRunAt } = resolved;
            await db.insert(schedules).values({
                id,
                title,
                prompt,
                agentId,
                kind: plan.kind,
                timeText: plan.timeText,
                intervalMinutes: plan.intervalMinutes,
                days: plan.days,
                startsAt: plan.startsAt,
                nextRunAt,
                enabled: true,
            });
            return `已创建定时任务 [${id}]：${title}（${describeSchedule(plan)}，下一次 ${formatWhen(nextRunAt)} ${clockOf(nextRunAt)}）`;
        },
    });

    set.work_create_note = tool({
        description: '在工作台记一条笔记（正文为 Markdown）。用于「帮我记一下…」这类沉淀信息；不要用它存超长文档。',
        inputSchema: zod.object({
            title: zod.string().describe(`标题，最长 ${WORK_TITLE_MAX} 字`),
            content: zod.string().describe('Markdown 正文'),
            tags: zod.array(zod.string()).optional().describe('标签列表'),
        }),
        execute: async (input) => {
            const blocked = await gateWrite('note');
            if (blocked) return blocked;
            let title: string;
            let content: string;
            try {
                title = normalizeWorkText(input.title, 'title', WORK_TITLE_MAX);
                content = normalizeWorkOptionalText(input.content, 'content', NOTE_CONTENT_MAX);
            } catch (error) {
                return `参数不合法：${(error as Error).message ?? String(error)}`;
            }
            const id = crypto.randomUUID();
            const tagList = normalizeWorkTags(input.tags);
            await db.insert(notes).values({ id, title, content, tags: tagList });
            // 与界面新建同口径：异步补摘要与向量，让这条笔记立刻能被 work_search 的语义路径检索到
            scheduleNoteIndex(id);
            return `已记录笔记 [${id}] ${title}${tagList.length ? `（标签：${tagList.join('、')}）` : ''}`;
        },
    });

    set.work_search = tool({
        description: '在工作台里检索：笔记与定时任务。用于回答「我之前记过…吗」「关于 X 有什么安排」这类需要历史内容的问题。',
        inputSchema: zod.object({
            keyword: zod.string().describe('检索关键词，命中各实体的标题与正文'),
            limit: zod.number().optional().describe('每类最多返回条数，默认 10，最多 20'),
        }),
        execute: async (input) => {
            const keyword = stringParam(input.keyword, 128) ?? '';
            if (!keyword) return 'keyword 不能为空';
            const pattern = likePattern(keyword);
            const limit = Math.min(Math.max(Math.floor(Number(input.limit) || 10), 1), RESULT_ROWS_MAX);
            const [ns, ss] = await Promise.all([
                db
                    .select({
                        id: notes.id,
                        title: notes.title,
                        updatedAt: notes.updatedAt,
                        // 优先用 AI 摘要（已是单段纯文本），没摘要才截正文；正文里的 Markdown 与换行会撑爆清单
                        snippet: sql<string>`coalesce(nullif(${notes.summary}, ''), left(${notes.content}, 160))`,
                    })
                    .from(notes)
                    .where(or(ilike(notes.title, pattern), ilike(notes.content, pattern), ilike(notes.summary, pattern)))
                    .orderBy(desc(notes.updatedAt))
                    .limit(limit),
                db
                    .select(scheduleColumns)
                    .from(schedules)
                    .where(or(ilike(schedules.title, pattern), ilike(schedules.prompt, pattern)))
                    .orderBy(asc(schedules.nextRunAt))
                    .limit(limit),
            ]);
            const blocks = [
                `笔记 ${ns.length}：${ns.map((n) => `- [${n.id}] ${clip(n.title || '无标题')}：${clip(n.snippet)}`).join('\n') || '无'}`,
                `定时任务 ${ss.length}：${ss.map(scheduleLine).join('\n') || '无'}`,
            ];
            return `「${keyword}」的检索结果：\n${blocks.join('\n')}`;
        },
    });

    return set as ToolSet;
}

/** 供系统提示词的工具清单使用：与上面实现保持同一份口径，不在两处各写一遍。 */
export const WORKBENCH_TOOL_SUMMARY = [
    '- work_today：今日概览（今天要跑的定时任务 / 今天已跑出的结果 / 未来 7 天安排 / 最近笔记）',
    '- work_list_schedules / work_create_schedule：查、建定时任务（到点自动跑智能体并把结果落成会话）',
    '- work_create_note：记笔记（Markdown）',
    '- work_search：跨笔记与定时任务检索',
].join('\n');
