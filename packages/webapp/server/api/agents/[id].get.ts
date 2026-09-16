import { eq } from 'drizzle-orm';
import { agentKnowledgeBases, agentMcpServers, agentSkills, agentTools, agents, knowledgeBases, mcpServers, skills, tools } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireUser(event);
    const id = getRouterParam(event, 'id')!;

    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    if (!agent || !agent.enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Agent not found' });
    }
    const boundSkills = await db
        .select({ id: skills.id, name: skills.name, description: skills.description })
        .from(agentSkills)
        .innerJoin(skills, eq(skills.id, agentSkills.skillId))
        .where(eq(agentSkills.agentId, id));
    const boundTools = await db
        .select({ id: tools.id, name: tools.name, type: tools.type, description: tools.description })
        .from(agentTools)
        .innerJoin(tools, eq(tools.id, agentTools.toolId))
        .where(eq(agentTools.agentId, id));

    // 知识库 / MCP 服务器只回名称，供对话页展示能力来源（不暴露内部配置）
    const boundKnowledgeBases = await db
        .select({ id: knowledgeBases.id, name: knowledgeBases.name })
        .from(agentKnowledgeBases)
        .innerJoin(knowledgeBases, eq(knowledgeBases.id, agentKnowledgeBases.kbId))
        .where(eq(agentKnowledgeBases.agentId, id));
    const boundMcpServers = await db
        .select({ id: mcpServers.id, name: mcpServers.name })
        .from(agentMcpServers)
        .innerJoin(mcpServers, eq(mcpServers.id, agentMcpServers.mcpServerId))
        .where(eq(agentMcpServers.agentId, id));

    return { ...agent, skills: boundSkills, tools: boundTools, knowledgeBases: boundKnowledgeBases, mcpServers: boundMcpServers };
});
