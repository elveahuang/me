import { desc, eq } from 'drizzle-orm';
import { agents, conversations, user } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    // 查询参数可能是数组（?userId=a&userId=b）或非字符串；直接当作 id 传给 eq() 会让
    // postgres-js 把数组展开成标量参数并报 500，这里显式收敛为单个字符串。
    const rawUserId = getQuery(event).userId;
    const userId = typeof rawUserId === 'string' && rawUserId ? rawUserId : undefined;

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
