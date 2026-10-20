import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { conversations, sessionEvents, type SessionEventType, type SessionSurfaceOp } from '../../db/schema';
import { db } from '../../utils/db';

export { deriveMessages, type DerivedSessionMessage } from './projection';

/**
 * 事件源会话的首版落点（P1-1）。
 *
 * 这一版刻意只做“旁路”：`messages` 仍是读模型与唯一上下文来源，事件表负责留下不可变的
 * append-only 记录。这样即使事件写失败，聊天也不会 500；等 `deriveMessages()` 与旧消息在
 * 真实会话上对账通过后，P1-2 再把读路径切过来。
 *
 * seq 用「会话行锁 + max(seq)」分配，而不是 conversations.next_seq：
 * - 单会话串行、无空洞，并发写同一会话会排队；
 * - 少两列迁移，回填脚本也能复用同一把锁；
 * - 代价是每次追加多一次 max 查询，单主本机可以接受。
 */

export interface NewSessionEvent {
    type: SessionEventType;
    data: Record<string, unknown>;
    turnId?: string | null;
    stepId?: string | null;
    surfaceOp?: SessionSurfaceOp | null;
}

export interface SessionEventRow {
    conversationId: string;
    seq: number;
    type: string;
    turnId: string | null;
    stepId: string | null;
    surfaceOp: SessionSurfaceOp | null;
    data: Record<string, unknown>;
    createdAt: Date;
}

/** 追加一批事件；返回实际分配的 seq（与输入一一对应）。 */
export async function appendSessionEvents(conversationId: string, events: NewSessionEvent[]): Promise<number[]> {
    if (!events.length) return [];

    return db.transaction(async (tx) => {
        // 先锁会话行：同一会话的事件写入必须串行，否则两个请求会拿到同一个 max(seq)。
        const [conversation] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId)).for('update');
        if (!conversation) throw new Error(`会话不存在：${conversationId}`);

        const [max] = await tx
            .select({ seq: sql<number>`coalesce(max(${sessionEvents.seq}), 0)` })
            .from(sessionEvents)
            .where(eq(sessionEvents.conversationId, conversationId));
        let next = Number(max?.seq ?? 0);

        const rows = events.map((event) => ({
            conversationId,
            seq: ++next,
            type: event.type,
            turnId: event.turnId ?? null,
            stepId: event.stepId ?? null,
            surfaceOp: event.surfaceOp ?? null,
            data: event.data,
        }));
        await tx.insert(sessionEvents).values(rows);
        return rows.map((row) => row.seq);
    });
}

/**
 * 旁路写入：事件失败只记日志，绝不能把聊天/自动化变成 500。
 * 返回空数组表示这批事件没写进去，调用方不需要重试（回填脚本会补）。
 */
export async function appendSessionEventsBestEffort(conversationId: string, events: NewSessionEvent[]): Promise<number[]> {
    try {
        return await appendSessionEvents(conversationId, events);
    } catch (error) {
        console.error(`[session-events] 写入事件失败（conversation=${conversationId}，不影响本轮）:`, error);
        return [];
    }
}

export async function readSessionEvents(conversationId: string, afterSeq = 0, limit = 5000): Promise<SessionEventRow[]> {
    return db
        .select()
        .from(sessionEvents)
        .where(and(eq(sessionEvents.conversationId, conversationId), gt(sessionEvents.seq, afterSeq)))
        .orderBy(sessionEvents.seq)
        .limit(limit);
}

/**
 * 反向分页：`beforeSeq` 之前的最近 `limit` 条，返回按 seq 升序的一页。
 *
 * 时间线默认要看「最新发生了什么」，正向 `after=0` 会把最老的 100 条先读出来。
 * 这里用 `desc` 取最近一页再反转，`hasMore` 由「多取一条」判定，避免刚好整页时误报。
 */
export async function readSessionEventsBefore(
    conversationId: string,
    beforeSeq: number,
    limit: number,
): Promise<{ rows: SessionEventRow[]; hasMore: boolean }> {
    const rows = await db
        .select()
        .from(sessionEvents)
        .where(and(eq(sessionEvents.conversationId, conversationId), lt(sessionEvents.seq, beforeSeq)))
        .orderBy(desc(sessionEvents.seq))
        .limit(limit + 1);
    const hasMore = rows.length > limit;
    return { rows: rows.slice(0, limit).reverse(), hasMore };
}

/**
 * 读取一个会话的全部事件（分页，避免单页 5000 条截断）。
 * 上限 50k 是保护：真到这么长的会话，恢复只看前 50k 也足以判断最近一轮的工具配对。
 */
export async function readAllSessionEvents(conversationId: string, max = 50_000): Promise<SessionEventRow[]> {
    const all: SessionEventRow[] = [];
    let afterSeq = 0;
    while (all.length < max) {
        const page = await readSessionEvents(conversationId, afterSeq, Math.min(5000, max - all.length));
        if (!page.length) break;
        all.push(...page);
        afterSeq = page[page.length - 1]!.seq;
        if (page.length < 5000) break;
    }
    return all;
}
