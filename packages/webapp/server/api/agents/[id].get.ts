import { and, eq } from 'drizzle-orm';
import { agentKnowledgeBases, agentMcpServers, agentSkills, agentTools, agents, knowledgeBases, mcpServers, skills, tools } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireUser(event);
    const id = getRouterParam(event, 'id')!;

    // 显式列出对外字段而不是 select() 全行后展开：agents 表带 system_prompt，
    // 那是运营侧提示词资产，任何登录用户 GET 一次就能读到；且未来给表加管理端专用列时，
    // 全行展开会让它默认出现在公开响应里。响应形状与契约的 AgentDetail 一一对应。
    const [agent] = await db
        .select({
            id: agents.id,
            name: agents.name,
            emoji: agents.emoji,
            avatar: agents.avatar,
            description: agents.description,
            model: agents.model,
            providerId: agents.providerId,
            temperature: agents.temperature,
            maxTokens: agents.maxTokens,
            maxSteps: agents.maxSteps,
            selfConfig: agents.selfConfig,
        })
        .from(agents)
        .where(and(eq(agents.id, id), eq(agents.enabled, true)));
    if (!agent) {
        throw createError({ statusCode: 404, statusMessage: '智能体不存在' });
    }
    // 能力清单必须与运行时口径一致：chat.post.ts / mcp.ts 加载技能、Tool、MCP 时都带 `enabled = true`，
    // 这里不过滤就会在对话头部把运营已停用的能力照常宣传（🛠️/🧩/🔌 计数与技能名 chip 都算上它），
    // 用户看到的现象是「卡片写着有这个能力，模型却完全不会用」。知识库表无 enabled 列，不在此列。
    const boundSkills = await db
        .select({ id: skills.id, name: skills.name, description: skills.description })
        .from(agentSkills)
        .innerJoin(skills, eq(skills.id, agentSkills.skillId))
        .where(and(eq(agentSkills.agentId, id), eq(skills.enabled, true)));
    const boundTools = await db
        .select({ id: tools.id, name: tools.name, type: tools.type, description: tools.description })
        .from(agentTools)
        .innerJoin(tools, eq(tools.id, agentTools.toolId))
        .where(and(eq(agentTools.agentId, id), eq(tools.enabled, true)));

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
        .where(and(eq(agentMcpServers.agentId, id), eq(mcpServers.enabled, true)));

    return { ...agent, skills: boundSkills, tools: boundTools, knowledgeBases: boundKnowledgeBases, mcpServers: boundMcpServers };
});
