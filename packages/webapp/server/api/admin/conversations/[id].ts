import { desc, eq } from 'drizzle-orm';
import { conversations, messages } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { requireMethod } from '../../../utils/method';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    // 本资源只有「读详情」与「删除」两种语义，其余方法不给隐式读的机会
    const method = requireMethod(event, ['GET', 'DELETE']);
    const id = getRouterParam(event, 'id')!;

    if (method === 'DELETE') {
        // 与 providers/skills/tools/agents 同口径：0 行影响要报 404。
        // 这里的 DELETE 跑在选择会话之前，id 抄错或会话已被另一个管理员删掉时原本回 ok:true，
        // 管理端照样提示「已删除」。
        const deleted = await db.delete(conversations).where(eq(conversations.id, id)).returning({ id: conversations.id });
        if (!deleted.length) throw createError({ statusCode: 404, statusMessage: '会话不存在' });
        return { ok: true };
    }

    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conversation) {
        throw createError({ statusCode: 404, statusMessage: '会话不存在' });
    }

    // 用 seq 排序而非 createdAt：同一秒内写入的多条消息靠 createdAt 会乱序
    // （messages.seq 正是为此引入的全局递增序列）。
    // 同时限制条数，避免超长会话把管理端一次拉爆。
    const limit = Math.min(Math.max(1, Math.floor(Number(getQuery(event).limit)) || 500), 1000);
    const recent = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(desc(messages.seq)).limit(limit);
    const rows = recent.reverse();
    return { conversation, messages: rows.map((m) => ({ id: m.id, role: m.role, parts: m.parts })) };
});
