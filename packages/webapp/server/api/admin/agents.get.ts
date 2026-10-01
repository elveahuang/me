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

    // 预分组，避免对每个 agent 遍历全部绑定并对每条绑定 .find（O(agents × bindings)）：
    // 按 agentId 建一次索引，实体表按 id 建 Map，列表组装退化为线性拼接。
    const skillsById = new Map(allSkills.map((s) => [s.id, s]));
    const toolsById = new Map(allTools.map((t) => [t.id, t]));
    const providerById = new Map(providerRows.map((p) => [p.id, p]));
    const groupAgentIds = <T extends { agentId: string }>(list: T[], key: (row: T) => string) => {
        const map = new Map<string, string[]>();
        for (const row of list) {
            const value = key(row);
            const bucket = map.get(row.agentId);
            if (bucket) bucket.push(value);
            else map.set(row.agentId, [value]);
        }
        return map;
    };
    const skillIdsByAgent = groupAgentIds(bindings, (b) => b.skillId);
    const toolIdsByAgent = groupAgentIds(toolBindings, (b) => b.toolId);
    const kbIdsByAgent = groupAgentIds(kbBindings, (b) => b.kbId);
    const mcpIdsByAgent = groupAgentIds(mcpBindings, (b) => b.mcpServerId);
    const kbById = new Map(allKbs.map((k) => [k.id, k]));
    const mcpById = new Map(allMcp.map((m) => [m.id, m]));
    const pick = <T>(ids: string[] | undefined, byId: Map<string, T>) => (ids ?? []).map((id) => byId.get(id)).filter((v): v is T => Boolean(v));

    return rows.map((agent) => {
        const skillIds = skillIdsByAgent.get(agent.id) ?? [];
        const toolIds = toolIdsByAgent.get(agent.id) ?? [];
        const kbIds = kbIdsByAgent.get(agent.id) ?? [];
        const mcpIds = mcpIdsByAgent.get(agent.id) ?? [];
        return {
            ...agent,
            skillIds,
            skills: pick(skillIds, skillsById),
            toolIds,
            tools: pick(toolIds, toolsById),
            kbIds,
            knowledgeBases: pick(kbIds, kbById),
            mcpIds,
            mcpServers: pick(mcpIds, mcpById),
            provider: agent.providerId ? (providerById.get(agent.providerId) ?? null) : null,
        };
    });
});
