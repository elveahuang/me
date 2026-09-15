import { and, desc, eq } from 'drizzle-orm';
import { agents, conversations } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const query = getQuery(event);
    const agentId = query.agentId as string | undefined;
    const limit = Math.min(Number(query.limit) || 50, 200);
    const offset = Number(query.offset) || 0;

    const rows = await db
        .select({
            id: conversations.id,
            title: conversations.title,
            agentId: conversations.agentId,
            agentName: agents.name,
            updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .innerJoin(agents, eq(agents.id, conversations.agentId))
        .where(agentId ? and(eq(conversations.userId, session.user.id), eq(conversations.agentId, agentId)) : eq(conversations.userId, session.user.id))
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset);
    return rows;
});
