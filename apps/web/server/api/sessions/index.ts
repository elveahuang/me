import { and, desc, eq } from 'drizzle-orm';
import { createError } from 'h3';
import { agents, conversations, spaces } from '../../db/schema';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { intParam, stringParam } from '../../utils/query';
import { rateLimit } from '../../utils/rate-limit';
import { capBody } from '../../utils/request-body';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 会话 API v2：只读索引列，不打开事件体。 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET', 'POST']);
    await capBody(event);

    if (event.method === 'GET') {
        const query = getQuery(event);
        const limit = intParam(query.limit, 50, 1, 200);
        const spaceId = stringParam(query.spaceId, 64)?.trim() || null;
        const agentId = stringParam(query.agentId, 64)?.trim() || null;
        const conditions = [spaceId ? eq(conversations.spaceId, spaceId) : undefined, agentId ? eq(conversations.agentId, agentId) : undefined].filter(
            (value): value is NonNullable<typeof value> => Boolean(value),
        );
        const rows = await db
            .select({
                id: conversations.id,
                title: conversations.title,
                agentId: conversations.agentId,
                spaceId: conversations.spaceId,
                planMode: conversations.planMode,
                createdAt: conversations.createdAt,
                updatedAt: conversations.updatedAt,
            })
            .from(conversations)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(conversations.updatedAt))
            .limit(limit);
        return { sessions: rows, limit };
    }

    const limited = await rateLimit('sessions:create', 30, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: '创建会话过于频繁' });
    const body = (await readBody(event)) ?? {};
    const agentId = typeof body.agentId === 'string' ? body.agentId : '';
    if (!UUID_RE.test(agentId)) throw createError({ statusCode: 400, statusMessage: 'agentId 非法' });
    const [agent] = await db.select({ id: agents.id, enabled: agents.enabled }).from(agents).where(eq(agents.id, agentId));
    if (!agent || !agent.enabled) throw createError({ statusCode: 404, statusMessage: '智能体不存在或未启用' });
    let spaceId: string | null = null;
    if (body.spaceId !== undefined && body.spaceId !== null && body.spaceId !== '') {
        if (typeof body.spaceId !== 'string' || !UUID_RE.test(body.spaceId)) throw createError({ statusCode: 400, statusMessage: 'spaceId 非法' });
        const [space] = await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, body.spaceId));
        if (!space) throw createError({ statusCode: 404, statusMessage: '工作空间不存在' });
        spaceId = body.spaceId;
    }
    const title =
        typeof body.title === 'string'
            ? body.title
                  .replace(/\u0000/g, '')
                  .trim()
                  .slice(0, 200)
            : '';
    const [created] = await db
        .insert(conversations)
        .values({ id: crypto.randomUUID(), agentId, spaceId, title: title || '新对话' })
        .returning();
    return { session: created };
});
