import { asc, max, sql } from 'drizzle-orm';
import { conversations, schedules, spaces } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { LOCAL_OWNER } from '../utils/owner';
import { rateLimit } from '../utils/rate-limit';
import { capBody, readCappedJsonBody } from '../utils/request-body';
import { ensureDefaultSpace, normalizeSpaceInput } from '../utils/spaces';

/** 工作空间列表与新建。单主应用，没有 owner 过滤。 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'POST']);
    await ensureDefaultSpace();

    if (method === 'POST') {
        const limited = await rateLimit(`space-create:${LOCAL_OWNER}`, 20, 60_000);
        if (!limited.ok) throw createError({ statusCode: 429, statusMessage: `创建过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
        const body = (await readCappedJsonBody<Record<string, unknown>>(event)) ?? {};
        const input = normalizeSpaceInput(body);
        const id = crypto.randomUUID();
        const [row] = await db
            .insert(spaces)
            .values({ id, ...input })
            .returning();
        return { ...row, conversationCount: 0, scheduleCount: 0, lastConversationAt: null };
    }

    const [spaceRows, conversationStats, scheduleStats] = await Promise.all([
        db.select().from(spaces).orderBy(asc(spaces.createdAt)),
        db
            .select({
                spaceId: conversations.spaceId,
                conversationCount: sql<number>`count(*)::int`,
                lastConversationAt: max(conversations.updatedAt),
            })
            .from(conversations)
            .groupBy(conversations.spaceId),
        db
            .select({
                spaceId: schedules.spaceId,
                scheduleCount: sql<number>`count(*)::int`,
                enabledScheduleCount: sql<number>`count(*) filter (where ${schedules.enabled})::int`,
            })
            .from(schedules)
            .groupBy(schedules.spaceId),
    ]);

    const conversationMap = new Map(conversationStats.map((row) => [row.spaceId, row]));
    const scheduleMap = new Map(scheduleStats.map((row) => [row.spaceId, row]));

    return spaceRows.map((space) => {
        const conv = conversationMap.get(space.id);
        const sched = scheduleMap.get(space.id);
        return {
            ...space,
            conversationCount: Number(conv?.conversationCount ?? 0),
            scheduleCount: Number(sched?.scheduleCount ?? 0),
            enabledScheduleCount: Number(sched?.enabledScheduleCount ?? 0),
            lastConversationAt: conv?.lastConversationAt ?? null,
        };
    });
});
