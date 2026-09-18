import { eq } from 'drizzle-orm';
import { agents, conversations } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const body = (await readBody(event)) ?? {};
    if (!body.agentId) {
        throw createError({ statusCode: 400, statusMessage: 'agentId is required' });
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, body.agentId));
    if (!agent || !agent.enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Agent not found' });
    }

    const id = crypto.randomUUID();
    await db.insert(conversations).values({
        id,
        userId: session.user.id,
        agentId: body.agentId,
        title: body.title || '新对话',
    });
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    return row;
});
