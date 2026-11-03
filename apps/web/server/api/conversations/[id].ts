import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { conversations, messages } from '../../db/schema';
import { dropChatRun } from '../../utils/chat-runs';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { stripNull } from '../../utils/pg-text';
import { intParam } from '../../utils/query';
import { capBody, readCappedJsonBody } from '../../utils/request-body';
import { routeId } from '../../utils/route-id';

const PatchConversationSchema = z.object({
    // 标题里带 U+0000 会让这条 UPDATE 连 SQL 一起 500（jsonb/text 列都不接受它）
    // trim 必须排在 min 之前：`title='   '` 原本按长度 3 通过校验并写库，
    // 而 chat 的自动改名只看 `!row.title`（空串），一个全空白的标题是 truthy——
    // 于是侧栏永久留一条看不见名字的会话，用户既读不出它也认不出它。
    title: z.string().trim().min(1).max(100).transform(stripNull),
});

export default defineEventHandler(async (event) => {
    const method = requireMethod(event, ['GET', 'PATCH', 'DELETE']);
    await capBody(event);
    const id = routeId(event, 'id', '会话');

    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conversation) {
        throw createError({ statusCode: 404, statusMessage: '会话不存在' });
    }

    if (method === 'DELETE') {
        await db.delete(conversations).where(eq(conversations.id, id));
        // 会话没了，它那轮的回放缓冲也就没有意义；留着会让重连接口把分片喂给一段不存在的历史
        dropChatRun(id);
        return { ok: true };
    }

    if (method === 'PATCH') {
        const body = (await readCappedJsonBody<Record<string, unknown>>(event)) ?? {};
        const parsed = PatchConversationSchema.safeParse(body);
        if (!parsed.success) {
            throw createError({ statusCode: 400, statusMessage: '会话标题不能为空且不能超过 100 字符' });
        }
        const [updated] = await db.update(conversations).set({ title: parsed.data.title, updatedAt: new Date() }).where(eq(conversations.id, id)).returning();
        if (!updated) throw createError({ statusCode: 404, statusMessage: '会话不存在' });
        return updated;
    }

    // 只回最近 N 条（取最新再反转，保持时间正序）。
    // 超长会话一次性拉全量会让响应体与内存随历史线性增长；
    // 会话页只需要近期上下文，更早的内容不影响阅读与续聊。
    // 走 intParam 而不是就地夹逼：那串 `… || 500` 会把 `?limit=0` 当成「没填」，
    // 于是「只要 0 条」的点击换来 500 条——想要的越少拿到越多，闸门是反着用的。
    const limit = intParam(getQuery(event).limit, 500, 1, 1000);
    const recent = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(desc(messages.seq)).limit(limit);
    const rows = recent.reverse();
    return { conversation, messages: rows.map((m) => ({ id: m.id, role: m.role, parts: m.parts })) };
});
