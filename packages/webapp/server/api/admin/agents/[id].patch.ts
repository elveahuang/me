import { eq } from 'drizzle-orm';
import { agents } from '../../../db/schema';
import { replaceAgentKnowledgeBases, replaceAgentMcpServers, replaceAgentSkills, replaceAgentTools } from '../../../utils/agent-skills';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const body = await readBody(event);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'emoji', 'avatar', 'description', 'systemPrompt', 'model', 'enabled', 'temperature', 'maxTokens', 'maxSteps'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.selfConfig !== undefined) patch.selfConfig = body.selfConfig;
    if (body.providerId !== undefined) patch.providerId = body.providerId || null;
    await db.update(agents).set(patch).where(eq(agents.id, id));
    if (body.skillIds) {
        await replaceAgentSkills(id, body.skillIds);
    }
    if (body.toolIds) {
        await replaceAgentTools(id, body.toolIds);
    }
    if (body.kbIds) {
        await replaceAgentKnowledgeBases(id, body.kbIds);
    }
    if (body.mcpIds) {
        await replaceAgentMcpServers(id, body.mcpIds);
    }
    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    return row;
});
