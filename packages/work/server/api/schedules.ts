import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { agents, schedules } from '../db/schema';
import { normalizeAdminBoolean } from '../utils/admin-boolean';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { LOCAL_OWNER } from '../utils/owner';
import { intParam, likePattern, stringParam } from '../utils/query';
import { rateLimit } from '../utils/rate-limit';
import { capBody } from '../utils/request-body';
import { assertScheduleAgent, resolveSchedulePlan } from '../utils/schedule-store';
import { WORK_TITLE_MAX, normalizeWorkDate, normalizeWorkText } from '../utils/work-input';
import { SCHEDULE_PROMPT_MAX } from '../utils/work-schedule';

/** 本机工作台的定时任务量级是「几十条」，这条上限只为让接口不无界。 */
const SCHEDULE_LIST_MAX = 200;

/** 列表与详情共用：正文只回前 240 字，完整正文走 `GET /api/schedules/{id}`（编辑表单才需要）。 */
const listColumns = {
    id: schedules.id,
    title: schedules.title,
    prompt: sql<string>`left(${schedules.prompt}, 240)`,
    agentId: schedules.agentId,
    agentName: agents.name,
    agentEmoji: agents.emoji,
    kind: schedules.kind,
    timeText: schedules.timeText,
    intervalMinutes: schedules.intervalMinutes,
    days: schedules.days,
    startsAt: schedules.startsAt,
    enabled: schedules.enabled,
    nextRunAt: schedules.nextRunAt,
    lastRunAt: schedules.lastRunAt,
    lastStatus: schedules.lastStatus,
    lastError: schedules.lastError,
    lastConversationId: schedules.lastConversationId,
    createdAt: schedules.createdAt,
    updatedAt: schedules.updatedAt,
};

export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'POST']);
    const query = getQuery(event);

    if (method === 'POST') {
        // 建定时任务的正常节奏是「一周几条」；异常脚本或提示词驱动的写循环会成百上千地刷，
        // 而 work 唯一的门是 Origin 核验，本机进程发出的请求一概放行。
        const limited = await rateLimit(`schedule-create:${LOCAL_OWNER}`, 30, 60_000);
        if (!limited.ok) throw createError({ statusCode: 429, statusMessage: `创建过于频繁，请 ${limited.retryAfterSec} 秒后再试` });

        const body = (await readBody(event)) ?? {};
        const startsAt = normalizeWorkDate(body.startsAt, 'startsAt');
        if (!startsAt) throw createError({ statusCode: 400, statusMessage: 'startsAt 必填' });
        const { plan, nextRunAt } = resolveSchedulePlan(
            { kind: body.kind, time: body.time, intervalMinutes: body.intervalMinutes, days: body.days, startsAt },
            new Date(),
        );
        // 标题/正文/开关先归一再进事务：`normalizeWorkText` 抛的是 400，没必要为一次注定失败的写入开事务
        const title = normalizeWorkText(body.title, 'title', WORK_TITLE_MAX);
        // prompt 是「到点发给智能体的那一句话」，空正文等于到点白跑一轮外呼，所以按必填处理
        const prompt = normalizeWorkText(body.prompt, 'prompt', SCHEDULE_PROMPT_MAX);
        const enabled = normalizeAdminBoolean(body.enabled, 'enabled', true);

        const id = crypto.randomUUID();
        await db.transaction(async (tx) => {
            const agentId = await assertScheduleAgent(body.agentId, tx);
            await tx.insert(schedules).values({
                id,
                title,
                prompt,
                agentId,
                kind: plan.kind,
                timeText: plan.timeText,
                intervalMinutes: plan.intervalMinutes,
                days: plan.days,
                startsAt: plan.startsAt,
                enabled,
                nextRunAt,
            });
        });
        const [row] = await db.select(listColumns).from(schedules).leftJoin(agents, eq(schedules.agentId, agents.id)).where(eq(schedules.id, id));
        // 提交之后这一行仍可能已经不在：`schedules.agent_id` 是 cascade，智能体恰好在这一刻被删就会把它一起带走。
        // 回 `undefined` 等于 200 + 空体，界面按「保存成功」收起表单，而用户从此在列表里找不到那条任务。
        if (!row) throw createError({ statusCode: 409, statusMessage: '这条定时任务在保存后立刻被删掉了（它指向的智能体可能刚被删除），请重新保存' });
        return row;
    }

    const where: SQL[] = [];
    const enabled = stringParam(query.enabled);
    if (enabled === '1') where.push(eq(schedules.enabled, true));
    if (enabled === '0') where.push(eq(schedules.enabled, false));

    const keyword = stringParam(query.keyword);
    if (keyword) where.push(or(ilike(schedules.title, likePattern(keyword)), ilike(schedules.prompt, likePattern(keyword)))!);

    const limit = intParam(query.limit, SCHEDULE_LIST_MAX, 1, SCHEDULE_LIST_MAX);
    // 列表带智能体名字与头像：页面上「每天 09:00 · 小助手」这一行不点进去就该认得出挂的是谁
    //
    // 启用中的排在前：停用（以及已经跑完的 `once`）那几条的 `nextRunAt` 会永远停在它被停用/跑完的那一刻，
    // 纯按 `nextRunAt` 升序就把它们钉在列表最前面，把今天真正要跑的那几条一路顶到底部。
    return db
        .select(listColumns)
        .from(schedules)
        .leftJoin(agents, eq(schedules.agentId, agents.id))
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(schedules.enabled), asc(schedules.nextRunAt))
        .limit(limit);
});
