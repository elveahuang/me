import { desc, eq } from 'drizzle-orm';
import { conversations, messages } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    if (getMethod(event) === 'DELETE') {
        await db.delete(conversations).where(eq(conversations.id, id));
        return { ok: true };
    }

    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conversation) {
        throw createError({ statusCode: 404, statusMessage: 'Conversation not found' });
    }

    // 用 seq 排序而非 createdAt：同一秒内写入的多条消息靠 createdAt 会乱序
    // （messages.seq 正是为此引入的全局递增序列）。
    // 同时限制条数，避免超长会话把管理端一次拉爆。
    const limit = Math.min(Math.max(1, Math.floor(Number(getQuery(event).limit)) || 500), 1000);
    const recent = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(desc(messages.seq)).limit(limit);
    const rows = recent.reverse();
    return { conversation, messages: rows.map((m) => ({ id: m.id, role: m.role, parts: m.parts })) };
});
