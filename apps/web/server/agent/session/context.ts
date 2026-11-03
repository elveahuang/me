import { and, desc, eq } from 'drizzle-orm';
import { messages as messagesTable, sessionEvents } from '../../db/schema';
import { db } from '../../utils/db';
import { readAllSessionEvents } from './events';
import { deriveMessages } from './projection';

export interface ContextMessage {
    id: string;
    role: string;
    parts: unknown[];
    seq: number;
}

export interface LoadedContext {
    messages: ContextMessage[];
    source: 'events' | 'messages';
}

/**
 * 会话上下文读取（P1-3 读路径切换的第一版）。
 *
 * 只有存在压缩标记时才读事件投影；未压缩的会话继续走 messages，避免每轮都扫全量事件。
 * 这样压缩摘要与区间遮蔽立即生效，同时把「读路径切换」的风险限制在真正用过的会话上。
 */
export async function loadConversationContext(conversationId: string, limit: number): Promise<LoadedContext> {
    const [marker] = await db
        .select({ seq: sessionEvents.seq })
        .from(sessionEvents)
        .where(and(eq(sessionEvents.conversationId, conversationId), eq(sessionEvents.type, 'compaction/end')))
        .limit(1);

    if (marker) {
        try {
            const events = await readAllSessionEvents(conversationId);
            const derived = deriveMessages(events);
            if (derived.length) {
                return {
                    messages: derived.slice(-limit).map((message) => ({
                        id: message.id,
                        role: message.role,
                        parts: message.parts,
                        seq: message.seq,
                    })),
                    source: 'events',
                };
            }
        } catch (error) {
            console.error('[context] 事件投影读取失败，回退 messages:', error);
        }
    }

    const recent = await db
        .select({ id: messagesTable.id, role: messagesTable.role, parts: messagesTable.parts, seq: messagesTable.seq })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conversationId))
        .orderBy(desc(messagesTable.seq))
        .limit(limit);
    return { messages: recent.reverse(), source: 'messages' };
}
