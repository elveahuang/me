import { count, desc, eq } from 'drizzle-orm';
import { agents, conversations, user } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

/** 列表最多返回最近这么多条；total 仍是库内全量计数 */
const LIST_LIMIT = 200;

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    // 查询参数可能是数组（?userId=a&userId=b）或非字符串；直接当作 id 传给 eq() 会让
    // postgres-js 把数组展开成标量参数并报 500，这里显式收敛为单个字符串。
    const rawUserId = getQuery(event).userId;
    const userId = typeof rawUserId === 'string' && rawUserId ? rawUserId : undefined;
    const where = userId ? eq(conversations.userId, userId) : undefined;

    const [rows, [totals]] = await Promise.all([
        db
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
            .where(where)
            .orderBy(desc(conversations.updatedAt))
            .limit(LIST_LIMIT),
        // 总数在库内聚合，且与列表用同一组 join/where：口径是「可展示的会话总量」，
        // 不是裸 conversations 行数（缺 agent/user 的行被 inner join 排除）
        db
            .select({ total: count() })
            .from(conversations)
            .innerJoin(user, eq(user.id, conversations.userId))
            .innerJoin(agents, eq(agents.id, conversations.agentId))
            .where(where),
    ]);

    return { conversations: rows, total: Number(totals?.total ?? 0), limit: LIST_LIMIT };
});
