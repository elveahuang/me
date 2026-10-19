import { eq } from 'drizzle-orm';
import { loadAgentCapabilities } from '../../../agent/runtime';
import { compactConversation } from '../../../agent/session/compaction';
import { agents, conversations } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { rateLimit } from '../../../utils/rate-limit';
import { capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);
    await capBody(event);
    const id = routeId(event, 'id', '会话');
    const limited = await rateLimit(`compact:${id}`, 5, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `压缩过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }

    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conversation) throw createError({ statusCode: 404, statusMessage: '会话不存在' });
    const [agent] = await db.select().from(agents).where(eq(agents.id, conversation.agentId));
    if (!agent || !agent.enabled) throw createError({ statusCode: 409, statusMessage: '会话所属智能体已停用，无法压缩' });

    const runtime = await loadAgentCapabilities(agent, conversation.spaceId);
    const result = await compactConversation(id, { model: runtime.model, modelName: agent.model, reason: 'manual' });
    return result;
});
