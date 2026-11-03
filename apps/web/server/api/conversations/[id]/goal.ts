import { eq } from 'drizzle-orm';
import { createError } from 'h3';
import { conversations } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { rateLimit } from '../../../utils/rate-limit';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';
import { createGoal, getGoal, updateGoal } from '../../../utils/session-assist';

/** 会话目标：GET 读 / POST 建 / PATCH 改。 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET', 'POST', 'PATCH']);
    await capBody(event);
    const id = routeId(event, 'id', '会话');
    const [conversation] = await db.select({ id: conversations.id, planMode: conversations.planMode }).from(conversations).where(eq(conversations.id, id));
    if (!conversation) throw createError({ statusCode: 404, statusMessage: '会话不存在' });

    if (event.method === 'GET') return { goal: await getGoal(id), planMode: conversation.planMode };

    const limited = await rateLimit(`goal:write:${id}`, 20, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: '目标更新过于频繁' });
    const body = (await readBody(event)) ?? {};
    if (event.method === 'POST') return { goal: await createGoal(id, body.objective, body.maxRounds) };
    return { goal: await updateGoal(id, body) };
});
