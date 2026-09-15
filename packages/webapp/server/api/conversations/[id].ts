import { and, asc, eq } from 'drizzle-orm';
import { conversations, messages } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const id = getRouterParam(event, 'id')!;

    const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, session.user.id)));
    if (!conversation) {
        throw createError({ statusCode: 404, statusMessage: 'Conversation not found' });
    }

    if (getMethod(event) === 'DELETE') {
        await db.delete(conversations).where(eq(conversations.id, id));
        return { ok: true };
    }

    const rows = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.seq));
    return { conversation, messages: rows.map((m) => ({ id: m.id, role: m.role, parts: m.parts })) };
});
