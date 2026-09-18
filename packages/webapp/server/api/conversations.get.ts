import { and, desc, eq } from 'drizzle-orm';
import { agents, conversations } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const query = getQuery(event);
    const agentId = query.agentId as string | undefined;
    // 分页参数必须夹在合法区间：负数会让 PostgreSQL 直接报错（2201W/2201X）
    // 并把 SQL 细节透出到响应体，NaN 也会让 offset 变成 NULL 语义
    const limit = Math.min(Math.max(1, Number(query.limit) || 50), 200);
    const offset = Math.max(0, Number(query.offset) || 0);

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
