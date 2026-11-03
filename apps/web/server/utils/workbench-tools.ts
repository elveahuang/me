import { tool, type ToolSet } from 'ai';
import { and, asc, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import * as zod from 'zod';
import {
    AUTOMATION_RUN_STATUSES,
    automationRuns,
    conversations,
    kbDocuments,
    knowledgeBases,
    SCHEDULE_KINDS,
    schedules,
    spaces,
    type ScheduleKind,
} from '../db/schema';
import { db } from './db';
import { ingestDocumentIntoKb } from './kb-ingest';
import { LOCAL_OWNER } from './owner';
import { stripNull } from './pg-text';
import { likePattern, stringParam } from './query';
import { rateLimit } from './rate-limit';
import { assertScheduleAgent, resolveSchedulePlan } from './schedule-store';
import { DEFAULT_SPACE_ID, ensureDefaultSpace, SPACE_INSTRUCTIONS_MAX } from './spaces';
import { shanghaiDateKey, shanghaiDayRange, shanghaiParts, shanghaiUpcomingEnd } from './work-day';
import { normalizeWorkDate, normalizeWorkText, WORK_TITLE_MAX } from './work-input';
import { describeSchedule, SCHEDULE_PROMPT_MAX, type SchedulePlan } from './work-schedule';

/**
 * 工作台内置工具：让任意智能体都能读写本机的工作台数据。
 *
 * 与 `buildToolSet()`（管理端配置的工具行）分开的理由：
 * 1. 这是本机的**私人事物**，不需要运营逐个绑定；用户说「每天九点跑一遍」时，
 *    答案不该取决于他选的这个智能体恰好挂了哪几行工具。
 * 2. 它们直接落到与 `/api/schedules` 同一张表、同一套入参归一，
 *    所以模型写入的行与用户在界面上手敲的行形状完全一致。
 * 3. 工具结果会进模型上下文，也可能进日志，因此一律输出「人读得懂的紧凑清单」，
 *    不外传正文全文、向量或供应商端点。
 *
 * 写侧一律带按次限流：work 唯一的门是 Origin 核验，本机进程发的请求一概放行，
 * 而模型在 agent 循环里可以连开 `maxSteps` 步，一次失控的提示就能刷出几十条记录。
 */

/** 工具结果进入模型上下文，条数与单条长度都要封顶：一次清单打满 50 条正文会把窗口挤爆。 */
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

/**
 * 把一次写入的失败折成「可以进模型上下文」的一句话。
 *
 * 工具结果是原样喂回给模型的，而模型这一轮的外呼对象是外部供应商——所以只有我们自己用
 * `createError` 造的、带 statusCode 的可读结论才允许透出。drizzle 的 `QueryError` 会把整条
 * SQL 与绑定参数（标题、prompt 正文）放进 message，AI SDK 的错误文本会带上游地址与模型名。
 * 认不出类别就只说「没写进去」，细节留在服务端日志里。
 */
function explainWriteFailure(error: unknown, context: string): string {
    const record = error as { statusCode?: number; statusMessage?: string };
    if (typeof record?.statusCode === 'number' && record.statusMessage) return record.statusMessage;
    console.error(`[workbench] ${context}失败:`, error);
    return `${context}失败，请改用界面手动操作`;
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

/** 写侧统一闸门：键按动作分开，将来多一种写入动作也不会共用一份预算。 */
async function gateWrite(action: string): Promise<string | null> {
    const limited = await rateLimit(`workbench-${action}:${LOCAL_OWNER}`, WRITE_LIMIT_PER_MIN, 60_000);
    return limited.ok ? null : `操作过于频繁（每分钟最多 ${WRITE_LIMIT_PER_MIN} 次），请 ${limited.retryAfterSec} 秒后再试`;
}

/**
 * @param agentId 当前这一轮对话所属的智能体。`work_create_schedule` 把新排期挂在它名下——
 *   谁被要求安排就该由谁到点执行；让模型自己挑 agentId 只会多一个「它记错了 id」的失败面。
 */
export function buildWorkbenchTools(agentId: string, spaceId: string | null = null): ToolSet {
    const spaceWhere = () => (spaceId ? eq(schedules.spaceId, spaceId) : isNull(schedules.spaceId));
    const set: Record<string, unknown> = {};

    set.work_today = tool({
        description: '读取工作台今日概览：今天要跑的定时任务、今天已跑出的结果、未来 7 天的安排。回答「今天有什么」「跑得怎么样」之前先调用它。',
        inputSchema: zod.object({}),
        execute: async () => {
            const now = new Date();
            const { start, end } = shanghaiDayRange(now);
            const weekEnd = shanghaiUpcomingEnd(end, 7);

            const [dueToday, runsToday, upcoming] = await Promise.all([
                db
                    .select(scheduleColumns)
                    .from(schedules)
                    .where(and(spaceWhere(), eq(schedules.enabled, true), gte(schedules.nextRunAt, start), lt(schedules.nextRunAt, end)))
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
                    .where(and(spaceWhere(), gte(schedules.lastRunAt, start), lt(schedules.lastRunAt, end), sql`${schedules.lastStatus} <> ''`))
                    .orderBy(desc(schedules.lastRunAt))
                    .limit(RESULT_ROWS_MAX),
                db
                    .select(scheduleColumns)
                    .from(schedules)
                    .where(and(spaceWhere(), eq(schedules.enabled, true), gte(schedules.nextRunAt, end), lt(schedules.nextRunAt, weekEnd)))
                    .orderBy(asc(schedules.nextRunAt))
                    .limit(RESULT_ROWS_MAX),
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
            const where: SQL[] = [spaceWhere()];
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
                const readable = (error as { statusMessage?: string })?.statusMessage;
                return `参数不合法：${readable || '请检查 kind / time / intervalMinutes / startsAt 的组合'}`;
            }
            const id = crypto.randomUUID();
            const { plan, nextRunAt } = resolved;
            try {
                await db.transaction(async (tx) => {
                    const ownerAgentId = await assertScheduleAgent(agentId, tx);
                    await tx.insert(schedules).values({
                        id,
                        title,
                        prompt,
                        agentId: ownerAgentId,
                        spaceId,
                        kind: plan.kind,
                        timeText: plan.timeText,
                        intervalMinutes: plan.intervalMinutes,
                        days: plan.days,
                        startsAt: plan.startsAt,
                        nextRunAt,
                        enabled: true,
                    });
                });
            } catch (error) {
                return explainWriteFailure(error, '定时任务没有创建');
            }
            return `已创建定时任务 [${id}]：${title}（${describeSchedule(plan)}，下一次 ${formatWhen(nextRunAt)} ${clockOf(nextRunAt)}）`;
        },
    });

    set.work_update_schedule = tool({
        description: '修改、暂停、启用或删除一条已有定时任务。根据 scheduleId 操作，可切换 enabled（启用/暂停）、修改 title/prompt，或设置 remove=true 删除。',
        inputSchema: zod.object({
            scheduleId: zod.string().describe('定时任务 ID'),
            enabled: zod.boolean().optional().describe('是否启用（false 为暂停）'),
            title: zod.string().optional().describe(`新标题，最长 ${WORK_TITLE_MAX} 字`),
            prompt: zod.string().optional().describe(`新指令正文，最长 ${SCHEDULE_PROMPT_MAX} 字`),
            remove: zod.boolean().optional().describe('设为 true 则删除该定时任务'),
        }),
        execute: async (input) => {
            const blocked = await gateWrite('schedule-update');
            if (blocked) return blocked;
            const id = stringParam(input.scheduleId, 64);
            if (!id) return 'scheduleId 必填';

            const [existing] = await db
                .select()
                .from(schedules)
                .where(and(eq(schedules.id, id), spaceWhere()));
            if (!existing) return `未找到定时任务 [${id}]`;

            if (input.remove) {
                await db.delete(schedules).where(eq(schedules.id, id));
                return `已删除定时任务 [${id}]：${clip(existing.title)}`;
            }

            const patch: Partial<typeof schedules.$inferInsert> = { updatedAt: new Date() };
            try {
                if (input.title !== undefined) {
                    patch.title = normalizeWorkText(input.title, 'title', WORK_TITLE_MAX);
                }
                if (input.prompt !== undefined) {
                    patch.prompt = normalizeWorkText(input.prompt, 'prompt', SCHEDULE_PROMPT_MAX);
                }
                if (typeof input.enabled === 'boolean') {
                    patch.enabled = input.enabled;
                }
                await db.update(schedules).set(patch).where(eq(schedules.id, id));
            } catch (error) {
                return explainWriteFailure(error, '更新定时任务');
            }
            return `已更新定时任务 [${id}]：${clip(patch.title ?? existing.title)}（状态：${(patch.enabled ?? existing.enabled) ? '启用' : '已暂停'}）`;
        },
    });

    set.work_list_runs = tool({
        description: '查询定时任务的最近运行记录（Run Ledger），包括运行状态（success/failed/running）、触发方式、耗时、产出会话与失败原因。',
        inputSchema: zod.object({
            scheduleId: zod.string().optional().describe('按定时任务 ID 过滤'),
            status: zod.enum(AUTOMATION_RUN_STATUSES).optional().describe('按运行状态过滤：running / success / failed'),
            limit: zod.number().optional().describe('返回条数，最多 30'),
        }),
        execute: async (input) => {
            const where: SQL[] = [spaceWhere()];
            const schedId = stringParam(input.scheduleId, 64);
            if (schedId) where.push(eq(automationRuns.scheduleId, schedId));
            if (input.status) where.push(eq(automationRuns.status, input.status));
            const limit = Math.min(Math.max(Math.floor(Number(input.limit) || 15), 1), 30);

            const rows = await db
                .select({
                    id: automationRuns.id,
                    scheduleTitle: schedules.title,
                    trigger: automationRuns.trigger,
                    status: automationRuns.status,
                    startedAt: automationRuns.startedAt,
                    durationMs: automationRuns.durationMs,
                    outputConversationId: automationRuns.outputConversationId,
                    error: automationRuns.error,
                    attempt: automationRuns.attempt,
                })
                .from(automationRuns)
                .innerJoin(schedules, eq(schedules.id, automationRuns.scheduleId))
                .where(and(...where))
                .orderBy(desc(automationRuns.startedAt))
                .limit(limit);

            if (!rows.length) return '暂无符合条件的运行记录';
            return `${rows.length} 条运行记录：\n${rows
                .map((r) => {
                    const dur = r.durationMs != null ? `，耗时 ${(r.durationMs / 1000).toFixed(1)}s` : '';
                    const detail =
                        r.status === 'failed'
                            ? `失败：${clip(r.error || '未知错误')}`
                            : r.outputConversationId
                              ? `成功（会话 [${r.outputConversationId}]）`
                              : r.status;
                    return `- [${r.id}] ${clip(r.scheduleTitle)}（${formatWhen(r.startedAt)} ${clockOf(r.startedAt)}，${r.trigger === 'manual' ? '手动' : '定时'}${dur}，第 ${r.attempt} 次尝试）→ ${detail}`;
                })
                .join('\n')}`;
        },
    });

    set.work_search = tool({
        description: '跨工作台搜索历史会话、知识库文档与定时任务。当用户询问「之前聊过什么」「知识库里有没有某资料」时调用。',
        inputSchema: zod.object({
            keyword: zod.string().describe('搜索关键词，1–100 字'),
        }),
        execute: async (input) => {
            const q = stringParam(input.keyword, 100);
            if (!q) return '请提供非空搜索关键词';
            const pat = likePattern(q);

            const [convHits, docHits, schedHits] = await Promise.all([
                db
                    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
                    .from(conversations)
                    .where(and(spaceId ? eq(conversations.spaceId, spaceId) : isNull(conversations.spaceId), ilike(conversations.title, pat)))
                    .orderBy(desc(conversations.updatedAt))
                    .limit(8),
                db
                    .select({
                        id: kbDocuments.id,
                        title: kbDocuments.title,
                        kbName: knowledgeBases.name,
                        content: kbDocuments.content,
                    })
                    .from(kbDocuments)
                    .innerJoin(knowledgeBases, eq(knowledgeBases.id, kbDocuments.kbId))
                    .where(
                        and(
                            spaceId ? or(eq(knowledgeBases.spaceId, spaceId), isNull(knowledgeBases.spaceId)) : isNull(knowledgeBases.spaceId),
                            or(ilike(kbDocuments.title, pat), ilike(kbDocuments.content, pat)),
                        ),
                    )
                    .orderBy(desc(kbDocuments.createdAt))
                    .limit(8),
                db
                    .select(scheduleColumns)
                    .from(schedules)
                    .where(and(spaceWhere(), or(ilike(schedules.title, pat), ilike(schedules.prompt, pat))))
                    .orderBy(asc(schedules.nextRunAt))
                    .limit(8),
            ]);

            const sections: string[] = [];
            if (docHits.length) {
                sections.push(`知识库文档（${docHits.length} 条）：\n` + docHits.map((d) => `- [${d.kbName}] ${clip(d.title)}：${clip(d.content)}`).join('\n'));
            }
            if (convHits.length) {
                sections.push(
                    `历史会话（${convHits.length} 条）：\n` + convHits.map((c) => `- [${c.id}] ${clip(c.title)}（${formatWhen(c.updatedAt)}）`).join('\n'),
                );
            }
            if (schedHits.length) {
                sections.push(`定时任务（${schedHits.length} 条）：\n` + schedHits.map(scheduleLine).join('\n'));
            }
            return sections.length ? sections.join('\n\n') : `未找到与「${clip(q)}」相关的会话、知识文档或定时任务`;
        },
    });

    set.work_save_knowledge = tool({
        description:
            '将整理好的结论、笔记、规范或报告沉淀为知识库文档（自动切块并建立向量索引），供后续对话检索。可指定 kbId，不传则自动写入当前空间或全局知识库。',
        inputSchema: zod.object({
            title: zod.string().describe('文档标题，最多 200 字'),
            content: zod.string().describe('要沉淀的 Markdown 或纯文本内容'),
            kbId: zod.string().optional().describe('目标知识库 ID（可选，不传则自动选择或创建默认知识库）'),
        }),
        execute: async (input) => {
            const blocked = await gateWrite('save-knowledge');
            if (blocked) return blocked;
            try {
                let targetKbId = stringParam(input.kbId, 64);
                if (targetKbId) {
                    const [found] = await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(eq(knowledgeBases.id, targetKbId));
                    if (!found) targetKbId = '';
                }
                if (!targetKbId) {
                    const existingKbs = await db
                        .select({ id: knowledgeBases.id, spaceId: knowledgeBases.spaceId })
                        .from(knowledgeBases)
                        .where(spaceId ? or(eq(knowledgeBases.spaceId, spaceId), isNull(knowledgeBases.spaceId)) : isNull(knowledgeBases.spaceId))
                        .orderBy(desc(knowledgeBases.createdAt))
                        .limit(5);
                    const preferred = existingKbs.find((k) => k.spaceId === spaceId) ?? existingKbs[0];
                    if (preferred) {
                        targetKbId = preferred.id;
                    } else {
                        targetKbId = crypto.randomUUID();
                        await db.insert(knowledgeBases).values({
                            id: targetKbId,
                            spaceId,
                            name: '工作台沉淀知识库',
                            description: '由对话与智能体自动沉淀的长期知识文档',
                            embeddingModel: 'text-embedding-3-small',
                        });
                    }
                }
                const doc = await ingestDocumentIntoKb({
                    kbId: targetKbId,
                    title: input.title,
                    content: input.content,
                });
                return `已沉淀到知识库文档 [${doc.id}]《${clip(doc.title)}》（共 ${doc.chunkCount} 个切片，索引方式：${doc.provider}）`;
            } catch (error) {
                return explainWriteFailure(error, '保存知识库文档');
            }
        },
    });

    set.work_update_space_memory = tool({
        description: '更新当前工作空间（Space）的长期指令与项目背景记忆（instructions）。当用户要求「记住这个项目规范」「以后在本空间都遵循某约定」时调用。',
        inputSchema: zod.object({
            content: zod.string().describe('要追加或替换的空间记忆/项目规范内容'),
            mode: zod.enum(['append', 'replace']).optional().describe('append 在现有说明末尾追加（默认），replace 覆盖全部说明'),
        }),
        execute: async (input) => {
            const blocked = await gateWrite('space-memory');
            if (blocked) return blocked;
            const addition = stripNull(input.content || '').trim();
            if (!addition) return '记忆内容不能为空';
            try {
                if (!spaceId) {
                    await ensureDefaultSpace();
                }
                const targetSpaceId = spaceId || DEFAULT_SPACE_ID;
                const [row] = await db.select().from(spaces).where(eq(spaces.id, targetSpaceId));
                if (!row) return '未找到当前工作空间';

                const nextInstructions = input.mode === 'replace' || !row.instructions.trim() ? addition : `${row.instructions.trim()}\n- ${addition}`;
                if (nextInstructions.length > SPACE_INSTRUCTIONS_MAX) {
                    return `工作空间记忆超出长度上限（最多 ${SPACE_INSTRUCTIONS_MAX} 字）`;
                }
                await db.update(spaces).set({ instructions: nextInstructions, updatedAt: new Date() }).where(eq(spaces.id, row.id));
                return `已更新工作空间「${row.name}」的长期记忆（当前共 ${nextInstructions.length} 字）`;
            } catch (error) {
                return explainWriteFailure(error, '更新工作空间记忆');
            }
        },
    });

    return set as ToolSet;
}

/** 供系统提示词的工具清单使用：与上面实现保持同一份口径，不在两处各写一遍。 */
export const WORKBENCH_TOOL_SUMMARY = [
    '- work_today：今日概览（今天要跑的定时任务 / 今天已跑出的结果 / 未来 7 天安排）',
    '- work_list_schedules / work_create_schedule / work_update_schedule：查、建、改/暂停/删定时任务（到点自动跑智能体并把结果落成会话）',
    '- work_list_runs：查询定时任务最近运行记录（状态、耗时、摘要与失败原因）',
    '- work_search：跨工作台搜索历史会话、知识库文档与定时任务',
    '- work_save_knowledge：将对话整理出的结论、笔记或报告一键沉淀进知识库并建立向量索引',
    '- work_update_space_memory：更新当前工作空间（Space）的长期指令与项目记忆',
].join('\n');
