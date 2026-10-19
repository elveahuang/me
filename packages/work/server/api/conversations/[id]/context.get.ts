import { and, eq } from 'drizzle-orm';
import { loadConversationContext } from '../../../agent/session/context';
import { estimateTokens } from '../../../agent/session/token-meter';
import { conversations, sessionEvents } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

const CONTEXT_WINDOW = 128_000;

export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    await capBody(event);
    const id = routeId(event, 'id', '会话');
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conversation) throw createError({ statusCode: 404, statusMessage: '会话不存在' });

    const [marker] = await db
        .select({ seq: sessionEvents.seq })
        .from(sessionEvents)
        .where(and(eq(sessionEvents.conversationId, id), eq(sessionEvents.type, 'compaction/end')))
        .limit(1);
    const loaded = await loadConversationContext(id, 500);
    const estimatedTokens = loaded.messages.reduce((sum, message) => sum + estimateTokens(JSON.stringify(message.parts ?? [])) + 4, 0);
    const budget = Math.floor(CONTEXT_WINDOW * 0.7);
    return {
        source: loaded.source,
        compacted: Boolean(marker),
        messageCount: loaded.messages.length,
        estimatedTokens,
        budget,
        percent: Math.min(100, Math.round((estimatedTokens / budget) * 100)),
    };
});
