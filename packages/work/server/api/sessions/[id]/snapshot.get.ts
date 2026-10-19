import { eq, max } from 'drizzle-orm';
import { createError } from 'h3';
import { loadConversationContext } from '../../../agent/session/context';
import { readSessionEvents } from '../../../agent/session/events';
import { deriveMessages } from '../../../agent/session/projection';
import { conversations, sessionEvents } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { intParam } from '../../../utils/query';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

/** 事件投影快照：`asOfSeq` 省略时取当前最大 seq。 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    await capBody(event);
    const id = routeId(event, 'id', '会话');
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conversation) throw createError({ statusCode: 404, statusMessage: '会话不存在' });

    const [head] = await db
        .select({ seq: max(sessionEvents.seq) })
        .from(sessionEvents)
        .where(eq(sessionEvents.conversationId, id));
    const requested = intParam(getQuery(event).asOfSeq, 0, 0, 2_147_483_647);
    const asOfSeq = requested && requested > 0 ? Math.min(requested, head?.seq ?? 0) : (head?.seq ?? 0);

    if (requested && requested > 0) {
        const events = (await readSessionEvents(id, 0, 50_000)).filter((row) => row.seq <= asOfSeq);
        const derived = deriveMessages(events);
        return {
            conversation,
            asOfSeq,
            source: 'events' as const,
            messages: derived.map((message) => ({ id: message.id, role: message.role, parts: message.parts, seq: message.seq })),
        };
    }

    const loaded = await loadConversationContext(id, 200);
    return { conversation, asOfSeq, source: loaded.source, messages: loaded.messages };
});
