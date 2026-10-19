import { eq } from 'drizzle-orm';
import { loadConversationContext } from '../../../agent/session/context';
import { conversations } from '../../../db/schema';
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

    // 默认读 messages；存在压缩标记时由 context 层改写为事件投影，旧区间被摘要遮蔽。
    const loaded = await loadConversationContext(id, limit);
    return loaded.messages.map((message) => ({ id: message.id, role: message.role, parts: message.parts }));
});
