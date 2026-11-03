import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { conversations } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { rateLimit } from '../../../utils/rate-limit';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

/** 计划模式开关：只改变下一轮系统提示词，不限制工具。 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['PUT']);
    await capBody(event);
    const id = routeId(event, 'id', '会话');
    const limited = await rateLimit(`plan-mode:${id}`, 30, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: '操作过于频繁' });
    const body = (await readBody(event)) ?? {};
    const enabled = body.enabled === true;
    const [row] = await db
        .update(conversations)
        .set({ planMode: enabled, updatedAt: new Date() })
        .where(eq(conversations.id, id))
        .returning({ id: conversations.id, planMode: conversations.planMode });
    if (!row) throw createError({ statusCode: 404, statusMessage: '会话不存在' });
    return row;
});
