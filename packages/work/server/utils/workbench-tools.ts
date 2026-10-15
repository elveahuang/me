import { tool, type ToolSet } from 'ai';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import * as zod from 'zod';
import { events, notes, projects, tasks, type TaskPriority, type TaskStatus } from '../db/schema';
import { db } from './db';
import { scheduleNoteIndex } from './note-index';
import { LOCAL_OWNER } from './owner';
import { likePattern, stringParam } from './query';
import { rateLimit } from './rate-limit';
import { UUID_PATTERN } from './route-id';
import { shanghaiDateKey, shanghaiDayRange } from './work-day';
import {
    NOTE_CONTENT_MAX,
    WORK_DETAIL_MAX,
    WORK_TITLE_MAX,
    normalizeTaskPriority,
    normalizeTaskStatus,
    normalizeWorkDate,
    normalizeWorkDateRange,
    normalizeWorkOptionalText,
    normalizeWorkTags,
    normalizeWorkText,
} from './work-input';
import { lockProjectRow } from './work-project';

/**
 * 工作台内置工具：让任意智能体都能读写本机的工作台数据。
 *
 * 与 `buildToolSet()`（管理端配置的工具行）分开的理由：
 * 1. 这是本机的**私人事物**，不需要运营逐个绑定；用户说「帮我记个待办」时，
 *    答案不该取决于他选的这个智能体恰好挂了哪几行工具。
 * 2. 它们直接落到与 `/api/tasks` 同一批表、同一套入参归一（`work-input.ts`），
 *    所以模型写入的行与用户在界面上手敲的行形状完全一致，只是 `source` 记成 `ai`。
 * 3. 工具结果会进模型上下文，也可能进日志，因此一律输出「人读得懂的紧凑清单」，
 *    不外传正文全文、向量或供应商端点。
 *
 * 写侧一律带按次限流：work 唯一的门是 Origin 核验，本机进程发的请求一概放行，
 * 而模型在 agent 循环里可以连开 `maxSteps` 步，一次失控的提示就能刷出几十条任务。
 */

/** 工具结果进入模型上下文，条数与单条长度都要封顶：一次 `work_search` 打满 50 条笔记正文会把窗口挤爆。 */
const RESULT_ROWS_MAX = 20;
const RESULT_TEXT_MAX = 400;
/** 单次工具写入的预算：正常对话一轮最多调用一两次，阈值只为「模型自我循环」而存在。 */
const WRITE_LIMIT_PER_MIN = 20;

function clip(value: string): string {
    const flat = value.replace(/\s+/g, ' ').trim();
    return flat.length > RESULT_TEXT_MAX ? `${flat.slice(0, RESULT_TEXT_MAX)}…` : flat;
}

function formatWhen(value: Date | null): string {
    if (!value) return '';
    return shanghaiDateKey(value) === shanghaiDateKey(new Date()) ? '今天' : shanghaiDateKey(value);
}

function taskLine(row: { id: string; title: string; status: string; priority: string; dueAt: Date | null }): string {
    return `- [${row.id}] ${row.title}（${row.status}/${row.priority}${row.dueAt ? `，到期 ${formatWhen(row.dueAt)}` : ''}）`;
}

/**
 * 模型给出的项目既可能是名字也可能是 id，且它只会照抄自己上一轮看到的文本。
 * 先按 uuid 形状认 id，再按名字精确匹配；匹配不上时把现有项目回给对方，
 * 让它能在下一步改正，而不是让一次拼错的项目名变成一整条失败写入。
 */
async function resolveProjectRef(raw: unknown): Promise<{ id: string | null; error?: string }> {
    if (raw === undefined || raw === null || raw === '') return { id: null };
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return { id: null, error: 'project 必须是非空字符串（项目名或项目 id）' };
    if (UUID_PATTERN.test(value)) {
        const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, value));
        return row ? { id: row.id } : { id: null, error: `项目 id ${value} 不存在` };
    }
    const rows = await db.select({ id: projects.id, name: projects.name }).from(projects).where(ilike(projects.name, value));
    if (rows.length === 1) return { id: rows[0]!.id };
    const names = await db.select({ name: projects.name }).from(projects).where(eq(projects.archived, false)).limit(30);
    if (rows.length > 1) return { id: null, error: `项目名「${value}」有歧义，现有项目：${names.map((n) => n.name).join('、')}` };
    return { id: null, error: `没有名为「${value}」的项目，现有项目：${names.map((n) => n.name).join('、') || '（暂无）'}` };
}

/** 写侧统一闸门：键按动作分开，让「建了 20 条任务」不影响「改一条状态」。 */
async function gateWrite(action: string): Promise<string | null> {
    const limited = await rateLimit(`workbench-${action}:${LOCAL_OWNER}`, WRITE_LIMIT_PER_MIN, 60_000);
    return limited.ok ? null : `操作过于频繁（每分钟最多 ${WRITE_LIMIT_PER_MIN} 次），请 ${limited.retryAfterSec} 秒后再试`;
}

/**
 * 按 id 或标题片段定位一条任务。
 *
 * 模型不总是留着 id（尤其跨轮对话），只给 id 会让「把那条周报的待办改成已完成」变成一次失败调用；
 * 但模糊命中必须只有一条才算数——多条时把候选回给对方，绝不自作主张改第一条。
 */
async function findTaskForPatch(input: {
    id?: string;
    title?: string;
}): Promise<{ ok: true; row: typeof tasks.$inferSelect } | { ok: false; message: string }> {
    if (input.id) {
        if (!UUID_PATTERN.test(input.id)) return { ok: false, message: 'id 不是合法的 task id' };
        const [row] = await db.select().from(tasks).where(eq(tasks.id, input.id));
        return row ? { ok: true, row } : { ok: false, message: `找不到 id 为 ${input.id} 的任务` };
    }
    const keyword = (input.title ?? '').trim();
    if (!keyword) return { ok: false, message: '必须提供 id 或 title 其中之一' };
    const rows = await db
        .select()
        .from(tasks)
        .where(and(ilike(tasks.title, likePattern(keyword)), inArray(tasks.status, ['todo', 'doing'] as TaskStatus[])))
        .orderBy(desc(tasks.updatedAt))
        .limit(5);
    if (rows.length === 1) return { ok: true, row: rows[0]! };
    if (!rows.length) return { ok: false, message: `没有未完成的任务标题匹配「${keyword}」` };
    return { ok: false, message: `「${keyword}」匹配到多条任务，请用 id 指明：\n${rows.map(taskLine).join('\n')}` };
}

export function buildWorkbenchTools(): ToolSet {
    const set: Record<string, unknown> = {};

    set.work_today = tool({
        description: '读取工作台今日概览：逾期与今天到期的任务、未来 7 天日程、各状态任务计数、最近笔记。回答「今天该做什么」之前先调用它。',
        inputSchema: zod.object({}),
        execute: async () => {
            const now = new Date();
            const { start, end } = shanghaiDayRange(now);
            const open = inArray(tasks.status, ['todo', 'doing'] as TaskStatus[]);
            const weekEnd = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

            const [overdue, dueToday, upcoming, counts] = await Promise.all([
                db
                    .select()
                    .from(tasks)
                    .where(and(open, isNotNull(tasks.dueAt), lt(tasks.dueAt, start)))
                    .orderBy(asc(tasks.dueAt))
                    .limit(RESULT_ROWS_MAX),
                db
                    .select()
                    .from(tasks)
                    .where(and(open, gte(tasks.dueAt, start), lt(tasks.dueAt, end)))
                    .orderBy(asc(tasks.dueAt))
                    .limit(RESULT_ROWS_MAX),
                db
                    .select({ id: events.id, title: events.title, startsAt: events.startsAt, allDay: events.allDay, location: events.location })
                    .from(events)
                    .where(and(gte(events.startsAt, now), lt(events.startsAt, weekEnd)))
                    .orderBy(asc(events.startsAt))
                    .limit(RESULT_ROWS_MAX),
                db
                    .select({ status: tasks.status, count: sql<number>`count(*)::int` })
                    .from(tasks)
                    .groupBy(tasks.status),
            ]);

            const stat = { todo: 0, doing: 0, done: 0, cancelled: 0 } as Record<string, number>;
            for (const row of counts) stat[row.status] = Number(row.count);

            const lines = [`今日（${shanghaiDateKey(now)}，北京时间）概览`, `任务计数：待办 ${stat.todo} / 进行中 ${stat.doing} / 已完成 ${stat.done}`];
            lines.push(`逾期 ${overdue.length} 条：${overdue.map(taskLine).join('\n') || '无'}`);
            lines.push(`今天到期 ${dueToday.length} 条：${dueToday.map(taskLine).join('\n') || '无'}`);
            lines.push(
                `未来 7 天日程 ${upcoming.length} 条：${upcoming.map((e) => `- [${e.id}] ${formatWhen(e.startsAt)} ${e.title}${e.location ? `（${e.location}）` : ''}`).join('\n') || '无'}`,
            );
            return lines.join('\n');
        },
    });

    set.work_list_tasks = tool({
        description:
            '列出工作台任务。可用 status（todo/doing/done/cancelled，逗号分隔）、keyword、projectId 或 project（项目名）过滤；不传 status 时只列未完成。',
        inputSchema: zod.object({
            status: zod.string().optional().describe('逗号分隔的状态，如 todo,doing'),
            keyword: zod.string().optional().describe('标题关键词'),
            project: zod.string().optional().describe('项目名或项目 id'),
            limit: zod.number().optional().describe('返回条数，最多 50'),
        }),
        execute: async (input) => {
            const where: SQL[] = [];
            const statusList = (input.status ?? '')
                .split(',')
                .map((s) => s.trim())
                .filter((s) => ['todo', 'doing', 'done', 'cancelled'].includes(s)) as TaskStatus[];
            where.push(statusList.length ? inArray(tasks.status, statusList) : inArray(tasks.status, ['todo', 'doing'] as TaskStatus[]));
            const keyword = stringParam(input.keyword, 128);
            if (keyword) where.push(ilike(tasks.title, likePattern(keyword)));
            const ref = await resolveProjectRef(input.project);
            if (ref.error) return ref.error;
            if (ref.id) where.push(eq(tasks.projectId, ref.id));
            const limit = Math.min(Math.max(Math.floor(Number(input.limit) || RESULT_ROWS_MAX), 1), 50);
            const rows = await db
                .select()
                .from(tasks)
                .where(and(...where))
                .orderBy(asc(tasks.dueAt), desc(tasks.createdAt))
                .limit(limit);
            if (!rows.length) return '没有符合条件的任务';
            return `${rows.length} 条任务：\n${rows.map(taskLine).join('\n')}`;
        },
    });

    set.work_create_task = tool({
        description: '在工作台新建一条任务。dueAt 用北京时间可懂的 ISO 日期（如 2026-10-16 或 2026-10-16T09:00:00+08:00）；project 传项目名或 id。',
        inputSchema: zod.object({
            title: zod.string().describe(`任务标题，最长 ${WORK_TITLE_MAX} 字`),
            detail: zod.string().optional().describe('补充说明（可选）'),
            priority: zod.enum(['low', 'medium', 'high']).optional().describe('优先级，默认 medium'),
            dueAt: zod.string().optional().describe('到期时间，ISO 字符串或毫秒时间戳'),
            project: zod.string().optional().describe('项目名或项目 id'),
        }),
        execute: async (input) => {
            const blocked = await gateWrite('task');
            if (blocked) return blocked;
            let projectId: string | null;
            try {
                const ref = await resolveProjectRef(input.project);
                if (ref.error) return ref.error;
                projectId = ref.id;
            } catch {
                return 'project 参数不合法：请传项目名或项目 id';
            }
            let title: string;
            let detail: string;
            let dueAt: Date | null;
            let priority: TaskPriority;
            try {
                title = normalizeWorkText(input.title, 'title', WORK_TITLE_MAX);
                detail = normalizeWorkOptionalText(input.detail, 'detail', WORK_DETAIL_MAX);
                dueAt = normalizeWorkDate(input.dueAt, 'dueAt');
                priority = normalizeTaskPriority(input.priority);
            } catch (error) {
                return `参数不合法：${(error as Error).message ?? String(error)}`;
            }
            const id = crypto.randomUUID();
            const status: TaskStatus = 'todo';
            await db.transaction(async (tx) => {
                await lockProjectRow(tx, projectId);
                await tx.insert(tasks).values({ id, projectId, title, detail, status, priority, dueAt, source: 'ai' });
            });
            return `已创建任务：${taskLine({ id, title, status, priority, dueAt })}`;
        },
    });

    set.work_update_task = tool({
        description: '修改任务：状态（todo/doing/done/cancelled）、优先级、到期时间。用 id 定位；没有 id 时可用 title 模糊匹配唯一的未完成任务。',
        inputSchema: zod.object({
            id: zod.string().optional().describe('任务 id'),
            title: zod.string().optional().describe('任务标题片段（仅当没有 id 时用）'),
            status: zod.enum(['todo', 'doing', 'done', 'cancelled']).optional(),
            priority: zod.enum(['low', 'medium', 'high']).optional(),
            dueAt: zod.string().nullable().optional().describe('新的到期时间；传 null 清空'),
        }),
        execute: async (input) => {
            const blocked = await gateWrite('task-patch');
            if (blocked) return blocked;
            const found = await findTaskForPatch({ id: input.id, title: input.title });
            if (!found.ok) return found.message;
            const patch: Record<string, unknown> = {};
            try {
                if (input.status !== undefined) {
                    const status = normalizeTaskStatus(input.status);
                    patch.status = status;
                    patch.completedAt = status === 'done' ? (found.row.completedAt ?? new Date()) : null;
                }
                if (input.priority !== undefined) patch.priority = normalizeTaskPriority(input.priority);
                if (input.dueAt !== undefined) patch.dueAt = normalizeWorkDate(input.dueAt, 'dueAt');
            } catch (error) {
                return `参数不合法：${(error as Error).message ?? String(error)}`;
            }
            if (!Object.keys(patch).length) return '没有需要修改的字段（status / priority / dueAt 至少给一个）';
            patch.updatedAt = new Date();
            await db.update(tasks).set(patch).where(eq(tasks.id, found.row.id));
            return `已更新任务 ${found.row.id}：${Object.keys(patch)
                .filter((k) => k !== 'updatedAt')
                .join('、')}`;
        },
    });

    set.work_create_note = tool({
        description: '在工作台记一条笔记（正文为 Markdown）。用于「帮我记一下…」这类沉淀信息；不要用它存超长文档。',
        inputSchema: zod.object({
            title: zod.string().describe(`标题，最长 ${WORK_TITLE_MAX} 字`),
            content: zod.string().describe('Markdown 正文'),
            tags: zod.array(zod.string()).optional().describe('标签列表'),
            project: zod.string().optional().describe('项目名或项目 id'),
        }),
        execute: async (input) => {
            const blocked = await gateWrite('note');
            if (blocked) return blocked;
            const ref = await resolveProjectRef(input.project);
            if (ref.error) return ref.error;
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
            await db.transaction(async (tx) => {
                await lockProjectRow(tx, ref.id);
                await tx.insert(notes).values({ id, projectId: ref.id, title, content, tags: tagList });
            });
            // 与界面新建同口径：异步补摘要与向量，让这条笔记立刻能被 work_search 的语义路径检索到
            scheduleNoteIndex(id);
            return `已记录笔记 [${id}] ${title}${tagList.length ? `（标签：${tagList.join('、')}）` : ''}`;
        },
    });

    set.work_create_event = tool({
        description: '在工作台日程里创建一个事件。startsAt 必填（北京时间可懂的 ISO 时间），可给 endsAt、location、allDay。',
        inputSchema: zod.object({
            title: zod.string().describe(`事件标题，最长 ${WORK_TITLE_MAX} 字`),
            startsAt: zod.string().describe('开始时间，ISO 字符串或毫秒时间戳'),
            endsAt: zod.string().optional().describe('结束时间，不得早于 startsAt'),
            location: zod.string().optional().describe('地点'),
            detail: zod.string().optional().describe('备注'),
            allDay: zod.boolean().optional().describe('是否全天'),
            project: zod.string().optional().describe('项目名或项目 id'),
        }),
        execute: async (input) => {
            const blocked = await gateWrite('event');
            if (blocked) return blocked;
            const ref = await resolveProjectRef(input.project);
            if (ref.error) return ref.error;
            let startsAt: Date | null;
            let title: string;
            let endsAt: Date | null;
            try {
                startsAt = normalizeWorkDate(input.startsAt, 'startsAt');
                if (!startsAt) return 'startsAt 必填';
                title = normalizeWorkText(input.title, 'title', WORK_TITLE_MAX);
                endsAt = normalizeWorkDateRange(input.endsAt, startsAt);
            } catch (error) {
                return `参数不合法：${(error as Error).message ?? String(error)}`;
            }
            const id = crypto.randomUUID();
            await db.transaction(async (tx) => {
                await lockProjectRow(tx, ref.id);
                await tx.insert(events).values({
                    id,
                    projectId: ref.id,
                    title,
                    detail: normalizeWorkOptionalText(input.detail, 'detail', WORK_DETAIL_MAX),
                    startsAt,
                    endsAt,
                    allDay: input.allDay === true,
                    location: normalizeWorkOptionalText(input.location, 'location', 200),
                    source: 'ai',
                });
            });
            return `已创建日程 [${id}] ${title}（${startsAt.toISOString()}）`;
        },
    });

    set.work_search = tool({
        description: '在工作台里检索：任务、笔记、日程、项目。用于回答「我之前记过…吗」「关于 X 的任务有哪些」这类需要历史内容的问题。',
        inputSchema: zod.object({
            keyword: zod.string().describe('检索关键词，命中各实体的标题与正文'),
            limit: zod.number().optional().describe('每类最多返回条数，默认 10，最多 20'),
        }),
        execute: async (input) => {
            const keyword = stringParam(input.keyword, 128) ?? '';
            if (!keyword) return 'keyword 不能为空';
            const pattern = likePattern(keyword);
            const limit = Math.min(Math.max(Math.floor(Number(input.limit) || 10), 1), RESULT_ROWS_MAX);
            const [ts, ns, es, ps] = await Promise.all([
                db
                    .select({ id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority, dueAt: tasks.dueAt })
                    .from(tasks)
                    .where(or(ilike(tasks.title, pattern), ilike(tasks.detail, pattern)))
                    .orderBy(desc(tasks.updatedAt))
                    .limit(limit),
                db
                    .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt, snippet: sql<string>`left(${notes.content}, 160)` })
                    .from(notes)
                    .where(or(ilike(notes.title, pattern), ilike(notes.content, pattern)))
                    .orderBy(desc(notes.updatedAt))
                    .limit(limit),
                db
                    .select({ id: events.id, title: events.title, startsAt: events.startsAt })
                    .from(events)
                    .where(or(ilike(events.title, pattern), ilike(events.detail, pattern), ilike(events.location, pattern)))
                    .orderBy(desc(events.startsAt))
                    .limit(limit),
                db
                    .select({ id: projects.id, name: projects.name })
                    .from(projects)
                    .where(or(ilike(projects.name, pattern), ilike(projects.description, pattern)))
                    .limit(limit),
            ]);
            const blocks = [
                `任务 ${ts.length}：${ts.map(taskLine).join('\n') || '无'}`,
                `笔记 ${ns.length}：${ns.map((n) => `- [${n.id}] ${clip(n.title || '无标题')}：${clip(n.snippet)}`).join('\n') || '无'}`,
                `日程 ${es.length}：${es.map((e) => `- [${e.id}] ${e.title}（${formatWhen(e.startsAt)}）`).join('\n') || '无'}`,
                `项目 ${ps.length}：${ps.map((p) => `- [${p.id}] ${p.name}`).join('\n') || '无'}`,
            ];
            return `「${keyword}」的检索结果：\n${blocks.join('\n')}`;
        },
    });

    return set as ToolSet;
}

/** 供系统提示词的工具清单使用：与上面实现保持同一份口径，不在两处各写一遍。 */
export const WORKBENCH_TOOL_SUMMARY = [
    '- work_today：今日概览（逾期/今天到期/未来 7 天日程/任务计数）',
    '- work_list_tasks / work_create_task / work_update_task：查、建、改任务（状态、优先级、到期）',
    '- work_create_note：记笔记（Markdown）',
    '- work_create_event：创建日程',
    '- work_search：跨任务/笔记/日程/项目检索',
].join('\n');
