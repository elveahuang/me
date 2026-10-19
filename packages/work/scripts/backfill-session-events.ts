import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 把已有 `messages` 回填成 `session_events`（P1-1）。
 *
 * 幂等：按事件 `data.id` 跳过已存在的消息，可反复执行、可断点续跑。
 * 必须在加载 `server/utils/db` **之前** 读 `.env`：tsx 的静态 import 会先求值，
 * 否则脚本会连到 db.ts 的兜底库。
 */
for (const path of ['.env', '.env.local', '../../.env', '../../.env.local']) {
    const full = resolve(process.cwd(), path);
    if (existsSync(full)) {
        try {
            process.loadEnvFile(full);
        } catch {
            // ignore
        }
    }
}

const { asc, eq } = await import('drizzle-orm');
const { db, closeDbClient } = await import('../server/utils/db');
const { conversations, messages, sessionEvents } = await import('../server/db/schema');
const { appendSessionEvents, deriveMessages, readSessionEvents } = await import('../server/agent/session/events');

const BATCH_SIZE = 100;

let conversationsScanned = 0;
let messagesScanned = 0;
let eventsInserted = 0;

try {
    const rows = await db.select({ id: conversations.id }).from(conversations).orderBy(asc(conversations.createdAt));

    for (const conversation of rows) {
        conversationsScanned++;
        const history = await db.select().from(messages).where(eq(messages.conversationId, conversation.id)).orderBy(asc(messages.seq));
        messagesScanned += history.length;
        if (!history.length) continue;

        const existing = await db.select({ data: sessionEvents.data }).from(sessionEvents).where(eq(sessionEvents.conversationId, conversation.id));
        const seen = new Set(existing.map((event) => (typeof event.data.id === 'string' ? event.data.id : '')).filter(Boolean));
        const pending = history.filter((message) => !seen.has(message.id));

        for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
            const chunk = pending.slice(offset, offset + BATCH_SIZE);
            await appendSessionEvents(
                conversation.id,
                chunk.map((message) => ({
                    type: message.role === 'assistant' ? ('assistant/message' as const) : ('user/message' as const),
                    data: { id: message.id, parts: message.parts, backfilled: true },
                })),
            );
            eventsInserted += chunk.length;
        }

        // 抽样对账：回填后投影的消息 id/role/parts 必须与 messages 一致（顺序按 messages.seq）。
        const projected = deriveMessages(await readSessionEvents(conversation.id));
        const projectedById = new Map(projected.map((message) => [message.id, message]));
        const mismatch = history.find((message) => {
            const derived = projectedById.get(message.id);
            if (!derived || derived.role !== message.role) return true;
            return JSON.stringify(derived.parts) !== JSON.stringify(message.parts);
        });
        if (mismatch) {
            console.error(`[backfill] 投影不一致：conversation=${conversation.id} message=${mismatch.id}`);
            process.exitCode = 1;
        }
    }

    console.log(
        `[backfill] 完成：会话 ${conversationsScanned} 个，消息 ${messagesScanned} 条，新增事件 ${eventsInserted} 条，` +
            `投影对账${process.exitCode ? '失败' : '通过'}`,
    );
} finally {
    await closeDbClient();
}
