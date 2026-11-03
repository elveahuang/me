import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { conversations } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { rateLimit } from '../../../utils/rate-limit';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';
import { readTodoState, writeTodoState } from '../../../utils/session-assist';

/**
 * 会话待办：GET 读，PUT 整表替换。
 * PUT 与 todo_write 共用 normalize，UI 不能绕过 50 项/标题长度限制。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET', 'PUT']);
    await capBody(event);
    const id = routeId(event, 'id', '会话');
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id));
    if (!conversation) throw createError({ statusCode: 404, statusMessage: '会话不存在' });

    if (event.method === 'PUT') {
        const limited = await rateLimit(`todos:write:${id}`, 30, 60_000);
        if (!limited.ok) throw createError({ statusCode: 429, statusMessage: '待办保存过于频繁' });
        const body = (await readBody(event)) ?? {};
        return writeTodoState(id, body.items);
    }
    return readTodoState(id);
});
