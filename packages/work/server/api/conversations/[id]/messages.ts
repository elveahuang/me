import { desc, eq } from 'drizzle-orm';
import { conversations, messages } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { intParam } from '../../../utils/query';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    await capBody(event);
    const id = routeId(event, 'id', '会话');
    // 负数 LIMIT 会被 PostgreSQL 拒绝（2201W）并透出 SQL 细节，这里夹到合法区间。
    // 与 GET /api/conversations/[id] 同一处收口：`… || 200` 会把 `?limit=0` 当成「没填」而回 200 条。
    const limit = intParam(getQuery(event).limit, 200, 1, 500);

    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conversation) {
        throw createError({ statusCode: 404, statusMessage: '会话不存在' });
    }

    // 取最近 N 条后按 seq 正序返回，避免超长会话一次性拉全量
    const recent = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(desc(messages.seq)).limit(limit);
    const rows = recent.reverse();
    return rows.map((m) => ({ id: m.id, role: m.role, parts: m.parts }));
});
