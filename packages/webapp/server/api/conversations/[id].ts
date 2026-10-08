import { and, desc, eq } from 'drizzle-orm';
import { conversations, messages } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';
import { requireMethod } from '../../utils/method';

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    // 其余方法原本落进下面的读取分支：PUT/POST 也会拿到 200 + 会话内容，看起来像已经改成功了
    const method = requireMethod(event, ['GET', 'DELETE']);
    const id = getRouterParam(event, 'id')!;

    const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, session.user.id)));
    if (!conversation) {
        throw createError({ statusCode: 404, statusMessage: '会话不存在' });
    }

    if (method === 'DELETE') {
        await db.delete(conversations).where(eq(conversations.id, id));
        return { ok: true };
    }

    // 只回最近 N 条（取最新再反转，保持时间正序）。
    // 超长会话一次性拉全量会让响应体与内存随历史线性增长；
    // 会话页只需要近期上下文，更早的内容不影响阅读与续聊。
    const limit = Math.min(Math.max(1, Math.floor(Number(getQuery(event).limit)) || 500), 1000);
    const recent = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(desc(messages.seq)).limit(limit);
    const rows = recent.reverse();
    return { conversation, messages: rows.map((m) => ({ id: m.id, role: m.role, parts: m.parts })) };
});
