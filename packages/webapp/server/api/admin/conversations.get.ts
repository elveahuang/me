import { desc, eq } from 'drizzle-orm';
import { agents, conversations, user } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const userId = getQuery(event).userId as string | undefined;

    const rows = await db
        .select({
            id: conversations.id,
            title: conversations.title,
            userId: conversations.userId,
            userName: user.name,
            userEmail: user.email,
            agentId: conversations.agentId,
            agentName: agents.name,
            createdAt: conversations.createdAt,
            updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .innerJoin(user, eq(user.id, conversations.userId))
        .innerJoin(agents, eq(agents.id, conversations.agentId))
        .where(userId ? eq(conversations.userId, userId) : undefined)
        .orderBy(desc(conversations.updatedAt))
        .limit(200);
    return rows;
});
