import { asc, eq, max, sql } from 'drizzle-orm';
import { agents, attachments, conversations, kbDocuments, knowledgeBases, schedules, spaces } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { LOCAL_OWNER } from '../utils/owner';
import { stringParam } from '../utils/query';
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
        let defaultAgentName: string | null = null;
        let defaultAgentEmoji: string | null = null;
        if (input.defaultAgentId) {
            const [agentRow] = await db
                .select({ id: agents.id, name: agents.name, emoji: agents.emoji })
                .from(agents)
                .where(eq(agents.id, input.defaultAgentId));
            if (!agentRow) throw createError({ statusCode: 400, statusMessage: '默认智能体不存在' });
            defaultAgentName = agentRow.name;
            defaultAgentEmoji = agentRow.emoji;
        }
        const id = crypto.randomUUID();
        const [row] = await db
            .insert(spaces)
            .values({ id, ...input })
            .returning();
        return {
            ...row,
            defaultAgentName,
            defaultAgentEmoji,
            conversationCount: 0,
            scheduleCount: 0,
            enabledScheduleCount: 0,
            attachmentCount: 0,
            knowledgeBaseCount: 0,
            documentCount: 0,
            lastConversationAt: null,
        };
    }

    const includeArchived = stringParam(getQuery(event).includeArchived) === '1';
    const [spaceRows, agentRows, conversationStats, scheduleStats, attachmentStats, kbStats, docStats] = await Promise.all([
        db
            .select()
            .from(spaces)
            .where(includeArchived ? undefined : eq(spaces.archived, false))
            .orderBy(asc(spaces.createdAt)),
        db.select({ id: agents.id, name: agents.name, emoji: agents.emoji }).from(agents),
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
        db
            .select({ spaceId: attachments.spaceId, count: sql<number>`count(*)::int` })
            .from(attachments)
            .groupBy(attachments.spaceId),
        db
            .select({ spaceId: knowledgeBases.spaceId, count: sql<number>`count(*)::int` })
            .from(knowledgeBases)
            .groupBy(knowledgeBases.spaceId),
        db
            .select({ spaceId: knowledgeBases.spaceId, count: sql<number>`count(*)::int` })
            .from(kbDocuments)
            .innerJoin(knowledgeBases, eq(knowledgeBases.id, kbDocuments.kbId))
            .groupBy(knowledgeBases.spaceId),
    ]);

    const agentMap = new Map(agentRows.map((row) => [row.id, row]));
    const conversationMap = new Map(conversationStats.map((row) => [row.spaceId, row]));
    const scheduleMap = new Map(scheduleStats.map((row) => [row.spaceId, row]));
    const attachmentMap = new Map(attachmentStats.map((row) => [row.spaceId, row.count]));
    const kbMap = new Map(kbStats.map((row) => [row.spaceId, row.count]));
    const docMap = new Map(docStats.map((row) => [row.spaceId, row.count]));

    return spaceRows.map((space) => {
        const conv = conversationMap.get(space.id);
        const sched = scheduleMap.get(space.id);
        const defaultAgent = space.defaultAgentId ? agentMap.get(space.defaultAgentId) : undefined;
        return {
            ...space,
            defaultAgentName: defaultAgent?.name ?? null,
            defaultAgentEmoji: defaultAgent?.emoji ?? null,
            conversationCount: Number(conv?.conversationCount ?? 0),
            scheduleCount: Number(sched?.scheduleCount ?? 0),
            enabledScheduleCount: Number(sched?.enabledScheduleCount ?? 0),
            attachmentCount: Number(attachmentMap.get(space.id) ?? 0),
            knowledgeBaseCount: Number(kbMap.get(space.id) ?? 0),
            documentCount: Number(docMap.get(space.id) ?? 0),
            lastConversationAt: conv?.lastConversationAt ?? null,
        };
    });
});
