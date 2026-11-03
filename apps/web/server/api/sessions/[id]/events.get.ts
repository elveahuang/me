import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { readSessionEvents, readSessionEventsBefore } from '../../../agent/session/events';
import { conversations } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { intParam } from '../../../utils/query';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

/**
 * 事件分页。
 *
 * - 默认 `after` 之后的至多 limit 条，按 seq 升序（增量跟随、时间线首屏都可用）。
 * - 带 `before` 时取它之前的最近 limit 条，仍按 seq 升序返回；时间线的「加载更早」用它，
 *   不必先读完最老的 1000 条才知道最新一轮发生了什么。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    await capBody(event);
    const id = routeId(event, 'id', '会话');
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id));
    if (!conversation) throw createError({ statusCode: 404, statusMessage: '会话不存在' });
    const query = getQuery(event);
    const after = intParam(query.after, 0, 0, 2_147_483_647);
    const limit = intParam(query.limit, 200, 1, 1000);
    const hasBefore = query.before !== undefined && query.before !== '';
    const before = hasBefore ? intParam(query.before, 0, 1, 2_147_483_647) : 0;
    const page = hasBefore ? await readSessionEventsBefore(id, before, limit) : null;
    const rows = page ? page.rows : await readSessionEvents(id, after, limit);
    const nextSeq = rows.length ? (hasBefore ? rows[0]!.seq : rows[rows.length - 1]!.seq) : hasBefore ? before : after;
    return {
        events: rows.map((row) => ({
            seq: row.seq,
            type: row.type,
            turnId: row.turnId,
            stepId: row.stepId,
            surfaceOp: row.surfaceOp,
            data: row.data,
            createdAt: row.createdAt,
        })),
        nextAfter: hasBefore ? after : nextSeq,
        nextBefore: hasBefore ? nextSeq : rows.length ? rows[0]!.seq : 0,
        hasMore: page ? page.hasMore : rows.length === limit,
    };
});
