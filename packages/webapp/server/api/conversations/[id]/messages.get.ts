import { desc, eq } from 'drizzle-orm';
import { conversations, messages } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireUser } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const id = getRouterParam(event, 'id')!;
    // 负数 LIMIT 会被 PostgreSQL 拒绝（2201W）并透出 SQL 细节，这里夹到合法区间
    const limit = Math.min(Math.max(1, Number(getQuery(event).limit) || 200), 500);

    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conversation || conversation.userId !== session.user.id) {
        throw createError({ statusCode: 404, statusMessage: 'Conversation not found' });
    }

    // 取最近 N 条后按 seq 正序返回，避免超长会话一次性拉全量
    const recent = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(desc(messages.seq)).limit(limit);
    const rows = recent.reverse();
    return rows.map((m) => ({ id: m.id, role: m.role, parts: m.parts }));
});
