import { eq } from 'drizzle-orm';
import { agents } from '../../db/schema';
import { replaceAgentKnowledgeBases, replaceAgentMcpServers, replaceAgentSkills, replaceAgentTools } from '../../utils/agent-skills';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const body = (await readBody(event)) ?? {};
    if (!body.name) {
        throw createError({ statusCode: 400, statusMessage: 'name is required' });
    }

    const id = crypto.randomUUID();
    await db.insert(agents).values({
        id,
        name: body.name,
        emoji: body.emoji ?? '🤖',
        avatar: body.avatar ?? null,
        description: body.description ?? '',
        systemPrompt: body.systemPrompt ?? '',
        model: body.model ?? 'deepseek-chat',
        providerId: body.providerId ?? null,
        selfConfig: body.selfConfig ?? false,
        enabled: body.enabled ?? true,
        temperature: body.temperature !== undefined ? body.temperature : 0.7,
        maxTokens: body.maxTokens !== undefined ? body.maxTokens : null,
        maxSteps: body.maxSteps !== undefined ? body.maxSteps : 6,
    });
    await replaceAgentSkills(id, body.skillIds ?? []);
    await replaceAgentTools(id, body.toolIds ?? []);
    await replaceAgentKnowledgeBases(id, body.kbIds ?? []);
    await replaceAgentMcpServers(id, body.mcpIds ?? []);

    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    return row;
});
