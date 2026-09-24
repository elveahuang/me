import { and, desc, eq } from 'drizzle-orm';
import { agents, conversations } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';
import { intParam } from '../utils/query';

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const query = getQuery(event);
    // 与管理端同一处理：重复参数会给数组，数组进 eq() 被 postgres-js 展开成标量参数 → 500 + SQL 细节外泄
    const rawAgentId = query.agentId;
    const agentId = typeof rawAgentId === 'string' && rawAgentId ? rawAgentId : undefined;
    // 分页参数必须夹在合法区间并取整：负数会让 PostgreSQL 直接报错（2201W/2201X）
    // 并把 SQL 细节透出到响应体，NaN 也会让 offset 变成 NULL 语义，小数则会被拒绝（22P02）
    const limit = intParam(query.limit, 50, 1, 200);
    // 上界 1e12：原表达式没有 Math.min，?offset=1e300 会原样进 SQL 撞 22003；
    // 1e12 远超任何合法分页量级，也不溢出 PG 的 int8
    const offset = intParam(query.offset, 0, 0, 1e12);

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
