import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { TASK_STATUSES, tasks } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { LOCAL_OWNER } from '../utils/owner';
import { intParam, likePattern, stringParam } from '../utils/query';
import { rateLimit } from '../utils/rate-limit';
import { capBody } from '../utils/request-body';
import { shanghaiDateInput } from '../utils/work-day';
import {
    WORK_DETAIL_MAX,
    WORK_TITLE_MAX,
    normalizeTaskPriority,
    normalizeTaskStatus,
    normalizeWorkDate,
    normalizeWorkOptionalText,
    normalizeWorkSource,
    normalizeWorkText,
} from '../utils/work-input';
import { assertProjectExists, lockProjectRow } from '../utils/work-project';

/** 一次最多返回的任务数：本机工作台不需要翻页，但也不能让一次查询无界。 */
const TASK_LIST_MAX = 500;

/** 优先级没有大小语义的列值，排序要显式给档位（high 在前）。 */
const PRIORITY_RANK = sql`case ${tasks.priority} when 'high' then 0 when 'medium' then 1 else 2 end`;

export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'POST']);
    const query = getQuery(event);

    if (method === 'POST') {
        // 建任务的正常节奏是「一天几十条」；异常脚本或提示词驱动的工具循环会成百上千地刷，
        // 而写接口在 work 唯一的门是 Origin 核验，本机进程发的请求一概放行。
        const limited = await rateLimit(`task-create:${LOCAL_OWNER}`, 60, 60_000);
        if (!limited.ok) throw createError({ statusCode: 429, statusMessage: `创建过于频繁，请 ${limited.retryAfterSec} 秒后再试` });

        const body = (await readBody(event)) ?? {};
        const status = normalizeTaskStatus(body.status);
        const id = crypto.randomUUID();
        const projectId = await assertProjectExists(body.projectId);
        const title = normalizeWorkText(body.title, 'title', WORK_TITLE_MAX);
        const detail = normalizeWorkOptionalText(body.detail, 'detail', WORK_DETAIL_MAX);
        const dueAt = normalizeWorkDate(body.dueAt, 'dueAt');
        const source = normalizeWorkSource(body.source);
        await db.transaction(async (tx) => {
            await lockProjectRow(tx, projectId);
            await tx.insert(tasks).values({
                id,
                projectId,
                title,
                detail,
                status,
                priority: normalizeTaskPriority(body.priority),
                dueAt,
                // 直接建成 done（助手补录历史任务）也要有完成时间，否则「已完成」没有发生时刻
                completedAt: status === 'done' ? new Date() : null,
                source,
            });
        });
        const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
        return row;
    }

    const where: SQL[] = [];

    const status = stringParam(query.status);
    if (status === 'open') {
        // 工作台默认视图：未完成（todo/doing），不含 done 与 cancelled
        where.push(inArray(tasks.status, ['todo', 'doing'] as (typeof TASK_STATUSES)[number][]));
    } else if (status) {
        const list = status
            .split(',')
            .map((s) => s.trim())
            .filter((s): s is (typeof TASK_STATUSES)[number] => (TASK_STATUSES as readonly string[]).includes(s));
        // 未知值整体忽略而不是报错：筛选条件常从书签/深链带进来，坏值当作「不加这层筛选」比 400 友好
        if (list.length) where.push(inArray(tasks.status, list));
    }

    const projectId = stringParam(query.projectId);
    if (projectId) where.push(eq(tasks.projectId, projectId));
    if (stringParam(query.noProject) === '1') where.push(isNull(tasks.projectId));

    const keyword = stringParam(query.keyword);
    if (keyword) where.push(ilike(tasks.title, likePattern(keyword)));

    // 到期区间按北京日切界：?dueFrom=2026-10-15&dueTo=2026-10-15 即「今天到期」
    const dueFrom = shanghaiDateInput(query.dueFrom, 'start');
    const dueTo = shanghaiDateInput(query.dueTo, 'end');
    if (dueFrom) where.push(gte(tasks.dueAt, dueFrom));
    if (dueTo) where.push(lt(tasks.dueAt, new Date(dueTo.getTime() + 1)));

    // ?overdue=1：已过到期时间且未完成，Today 页的红名单
    if (stringParam(query.overdue) === '1') {
        where.push(and(lt(tasks.dueAt, new Date()), inArray(tasks.status, ['todo', 'doing'] as (typeof TASK_STATUSES)[number][]))!);
    }

    const order =
        stringParam(query.order) === 'created'
            ? [desc(tasks.createdAt)]
            : stringParam(query.order) === 'priority'
              ? [PRIORITY_RANK, asc(tasks.dueAt)]
              : // PostgreSQL 的 `ASC` 默认就是 NULLS LAST（实测），无到期时间的任务自然沉到末尾，
                // 不会把「今天必须做」挤下去；这里不再显式写 NULLS LAST 以免与列排序方向脱节
                [asc(tasks.dueAt), desc(tasks.createdAt)];

    const limit = intParam(query.limit, TASK_LIST_MAX, 1, TASK_LIST_MAX);
    return db
        .select()
        .from(tasks)
        .where(where.length ? and(...where) : undefined)
        .orderBy(...order)
        .limit(limit);
});
