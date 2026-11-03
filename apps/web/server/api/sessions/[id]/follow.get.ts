import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { loadConversationContext } from '../../../agent/session/context';
import { readSessionEvents } from '../../../agent/session/events';
import { conversations } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { intParam } from '../../../utils/query';
import { routeId } from '../../../utils/route-id';

const POLL_MS = 1500;
const MAX_MS = 30 * 60_000;

/**
 * SSE 增量：先 snapshot，再按 seq 推新事件。
 * `Last-Event-ID` 优先于 `?after=`；客户端按 seq 去重，发现空洞重新拉 snapshot。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    const id = routeId(event, 'id', '会话');
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id));
    if (!conversation) throw createError({ statusCode: 404, statusMessage: '会话不存在' });

    const lastEventId = Number(getHeader(event, 'last-event-id'));
    const after = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : intParam(getQuery(event).after, 0, 0, 2_147_483_647);

    setResponseStatus(event, 200);
    setResponseHeader(event, 'content-type', 'text/event-stream; charset=utf-8');
    setResponseHeader(event, 'cache-control', 'no-cache, no-transform');
    setResponseHeader(event, 'connection', 'keep-alive');
    setResponseHeader(event, 'x-accel-buffering', 'no');

    const res = event.node.res;
    const write = (chunk: string) => {
        if (!res.writableEnded) res.write(chunk);
    };
    let closed = false;
    res.on('close', () => {
        closed = true;
    });

    const loaded = await loadConversationContext(id, 200);
    write(`event: snapshot\ndata: ${JSON.stringify({ conversationId: id, source: loaded.source, messages: loaded.messages })}\n\n`);

    let cursor = after;
    const startedAt = Date.now();
    while (!closed && !res.writableEnded && Date.now() - startedAt < MAX_MS) {
        const rows = await readSessionEvents(id, cursor, 200).catch(() => []);
        for (const row of rows) {
            write(`id: ${row.seq}\nevent: session\ndata: ${JSON.stringify({ seq: row.seq, type: row.type, data: row.data, createdAt: row.createdAt })}\n\n`);
            cursor = row.seq;
        }
        if (!rows.length) write(`: ping ${Date.now()}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (!res.writableEnded) res.end();
});
