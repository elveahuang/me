import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { conversations } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { requireMethod } from '../../../../utils/method';
import { rateLimit } from '../../../../utils/rate-limit';
import { capBody } from '../../../../utils/request-body';
import { routeId } from '../../../../utils/route-id';
import { continueGoal } from '../../../../utils/session-assist';

/** 「继续」按钮：只推进轮次，不自动发消息。 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);
    await capBody(event);
    const id = routeId(event, 'id', '会话');
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id));
    if (!conversation) throw createError({ statusCode: 404, statusMessage: '会话不存在' });
    const limited = await rateLimit(`goal:continue:${id}`, 10, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: '继续过于频繁' });
    return { goal: await continueGoal(id) };
});
