import { desc } from 'drizzle-orm';
import { agentKnowledgeBases, agentMcpServers, agentSkills, agentTools, agents, knowledgeBases, mcpServers, providers, skills, tools } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    const rows = await db.select().from(agents).orderBy(desc(agents.createdAt));
    const allSkills = await db.select().from(skills);
    const allTools = await db.select().from(tools);
    const bindings = await db.select().from(agentSkills);
    const toolBindings = await db.select().from(agentTools);
    const kbBindings = await db.select().from(agentKnowledgeBases);
    const allKbs = await db.select({ id: knowledgeBases.id, name: knowledgeBases.name }).from(knowledgeBases);
    const mcpBindings = await db.select().from(agentMcpServers);
    const allMcp = await db.select({ id: mcpServers.id, name: mcpServers.name }).from(mcpServers);
    const providerRows = await db.select({ id: providers.id, name: providers.name, models: providers.models }).from(providers);

    return rows.map((agent) => ({
        ...agent,
        skillIds: bindings.filter((b) => b.agentId === agent.id).map((b) => b.skillId),
        skills: bindings
            .filter((b) => b.agentId === agent.id)
            .map((b) => allSkills.find((s) => s.id === b.skillId))
            .filter(Boolean),
        toolIds: toolBindings.filter((b) => b.agentId === agent.id).map((b) => b.toolId),
        tools: toolBindings
            .filter((b) => b.agentId === agent.id)
            .map((b) => allTools.find((t) => t.id === b.toolId))
            .filter(Boolean),
        kbIds: kbBindings.filter((b) => b.agentId === agent.id).map((b) => b.kbId),
        knowledgeBases: allKbs.filter((k) => kbBindings.some((b) => b.agentId === agent.id && b.kbId === k.id)),
        mcpIds: mcpBindings.filter((b) => b.agentId === agent.id).map((b) => b.mcpServerId),
        mcpServers: allMcp.filter((m) => mcpBindings.some((b) => b.agentId === agent.id && b.mcpServerId === m.id)),
        provider: providerRows.find((p) => p.id === agent.providerId) ?? null,
    }));
});
