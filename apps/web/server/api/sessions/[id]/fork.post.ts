import { eq, max } from 'drizzle-orm';
import { createError } from 'h3';
import { readSessionEvents } from '../../../agent/session/events';
import { deriveMessages } from '../../../agent/session/projection';
import { conversations, messages, sessionEvents, sessionRuns } from '../../../db/schema';
import { db } from '../../../utils/db';
import { partsToPlainText } from '../../../utils/message-text';
import { requireMethod } from '../../../utils/method';
import { intParam } from '../../../utils/query';
import { rateLimit } from '../../../utils/rate-limit';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

/** 从 `asOfSeq` 分叉：复制投影出的消息到新会话，原会话与事件一字不改。 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);
    const limited = await rateLimit('sessions:fork', 10, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: '分叉过于频繁' });
    await capBody(event);
    const id = routeId(event, 'id', '会话');
    const [source] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!source) throw createError({ statusCode: 404, statusMessage: '会话不存在' });

    const body = (await readBody(event)) ?? {};
    const [head] = await db
        .select({ seq: max(sessionEvents.seq) })
        .from(sessionEvents)
        .where(eq(sessionEvents.conversationId, id));
    const requested = intParam(body.asOfSeq, head?.seq ?? 0, 0, 2_147_483_647);
    const asOfSeq = Math.min(requested, head?.seq ?? 0);
    if (!head?.seq) throw createError({ statusCode: 409, statusMessage: '源会话还没有可分叉的事件' });

    const events = (await readSessionEvents(id, 0, 50_000)).filter((row) => row.seq <= asOfSeq);
    const derived = deriveMessages(events);
    if (!derived.length) throw createError({ statusCode: 409, statusMessage: '该位置没有可复制的消息' });

    const title =
        typeof body.title === 'string'
            ? body.title
                  .replace(/\u0000/g, '')
                  .trim()
                  .slice(0, 200)
            : '';
    const forkedId = crypto.randomUUID();
    // 分叉点之前的运行台账一并复制：否则新会话看起来「有消息却没有执行记录」，
    // 按 seq 回放/审计时无法解释这些消息是哪一轮生成的。仍在跑的源运行标记为 interrupted。
    const cutoff = events[events.length - 1]?.createdAt ?? new Date();
    const sourceRuns = await db.select().from(sessionRuns).where(eq(sessionRuns.conversationId, id));
    const forkedRuns = sourceRuns
        .filter((row) => row.startedAt.getTime() <= cutoff.getTime())
        .map((row) => ({
            id: `fork_${crypto.randomUUID()}`,
            conversationId: forkedId,
            trigger: row.trigger,
            status: row.status === 'running' ? 'interrupted' : row.status,
            requestId: '',
            errorCode: row.status === 'running' ? 'FORKED_RUNNING' : row.errorCode,
            startedAt: row.startedAt,
            finishedAt: row.status === 'running' ? row.startedAt : row.finishedAt,
        }));
    await db.transaction(async (tx) => {
        await tx.insert(conversations).values({
            id: forkedId,
            agentId: source.agentId,
            spaceId: source.spaceId,
            title: title || `${source.title} · 分叉`,
            planMode: source.planMode,
        });
        if (forkedRuns.length) await tx.insert(sessionRuns).values(forkedRuns);
        await tx.insert(messages).values(
            derived.map((message) => ({
                id: `fork_${crypto.randomUUID()}`,
                conversationId: forkedId,
                role: message.role,
                parts: message.parts,
                contentText: partsToPlainText(message.parts),
            })),
        );
        await tx.insert(sessionEvents).values(
            derived.map((message, index) => ({
                conversationId: forkedId,
                seq: index + 1,
                type: message.role === 'user' ? 'user/message' : 'assistant/message',
                data: { id: message.id, parts: message.parts, forkedFrom: id, forkedFromSeq: asOfSeq },
            })),
        );
    });
    return {
        session: { id: forkedId, title: title || `${source.title} · 分叉`, agentId: source.agentId, spaceId: source.spaceId },
        asOfSeq,
        messageCount: derived.length,
        runCount: forkedRuns.length,
    };
});
