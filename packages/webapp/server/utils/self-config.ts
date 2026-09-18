import { tool, type Tool } from 'ai';
import { and, eq } from 'drizzle-orm';
import * as zod from 'zod';
import { agentKnowledgeBases, agentMcpServers, agentSkills, agentTools, agents, knowledgeBases, mcpServers, providers, skills, tools } from '../db/schema';
import { db } from './db';

/**
 * 智能体自治配置工具（仅对开启 selfConfig 的智能体注入）。
 * 允许智能体自行查看/切换模型、绑定解绑 Skill / Tool / MCP 服务器。
 */
export function buildSelfConfigTool(agentId: string): Tool {
    return tool({
        description:
            '配置你自己的能力。action=list 查看当前模型/Skill/Tool/知识库/MCP服务器和可用供应商；action=set_model 切换模型（providerId+modelId 需来自 list 结果）；action=toggle_skill / toggle_tool / toggle_knowledge / toggle_mcp 绑定或解绑对应能力。',
        inputSchema: zod.object({
            action: zod.enum(['list', 'set_model', 'toggle_skill', 'toggle_tool', 'toggle_knowledge', 'toggle_mcp']).describe('操作类型'),
            providerId: zod.string().optional().describe('目标供应商 id'),
            modelId: zod.string().optional().describe('目标模型 id'),
            skillId: zod.string().optional().describe('目标 Skill id'),
            toolId: zod.string().optional().describe('目标 Tool id'),
            kbId: zod.string().optional().describe('目标知识库 id'),
            mcpServerId: zod.string().optional().describe('目标 MCP 服务器 id'),
            enabled: zod.boolean().optional().describe('toggle_*：true 绑定 / false 解绑'),
        }),
        execute: async ({ action, providerId, modelId, skillId, toolId, kbId, mcpServerId, enabled }) => {
            const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
            if (!agent) return { error: '智能体不存在' };

            if (action === 'list') {
                const providerRows = await db.select().from(providers).where(eq(providers.enabled, true));
                const allSkills = await db.select().from(skills).where(eq(skills.enabled, true));
                const allTools = await db.select().from(tools).where(eq(tools.enabled, true));
                const allKnowledgeBases = await db.select().from(knowledgeBases);
                const allMcp = await db.select().from(mcpServers).where(eq(mcpServers.enabled, true));
                const boundSkills = await db.select().from(agentSkills).where(eq(agentSkills.agentId, agentId));
                const boundTools = await db.select().from(agentTools).where(eq(agentTools.agentId, agentId));
                const boundKnowledgeBases = await db.select().from(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, agentId));
                const boundMcp = await db.select().from(agentMcpServers).where(eq(agentMcpServers.agentId, agentId));
                return {
                    current: {
                        model: agent.model,
                        providerId: agent.providerId,
                        skillIds: boundSkills.map((b) => b.skillId),
                        toolIds: boundTools.map((b) => b.toolId),
                        knowledgeBaseIds: boundKnowledgeBases.map((b) => b.kbId),
                        mcpServerIds: boundMcp.map((b) => b.mcpServerId),
                    },
                    providers: providerRows.map((p) => ({ id: p.id, name: p.name, models: p.models })),
                    skills: allSkills.map((s) => ({ id: s.id, name: s.name, description: s.description })),
                    tools: allTools.map((t) => ({ id: t.id, name: t.name, type: t.type, description: t.description })),
                    knowledgeBases: allKnowledgeBases.map((k) => ({ id: k.id, name: k.name, description: k.description })),
                    // 不返回 url：模型只需 id+name 即可 toggle_mcp，暴露 MCP 端点（可能含内网地址/查询串令牌）无必要
                    mcpServers: allMcp.map((m) => ({ id: m.id, name: m.name })),
                };
            }

            if (action === 'set_model') {
                if (!modelId) return { error: 'set_model 需要 modelId' };
                const patch: Record<string, unknown> = { model: modelId, updatedAt: new Date() };
                if (providerId) {
                    const [p] = await db.select().from(providers).where(eq(providers.id, providerId));
                    if (!p || !p.enabled) return { error: '供应商不存在或未启用' };
                    if (p.models.length && !p.models.includes(modelId)) {
                        return { error: `模型 ${modelId} 不在供应商 ${p.name} 的模型列表里` };
                    }
                    patch.providerId = providerId;
                }
                await db.update(agents).set(patch).where(eq(agents.id, agentId));
                return { ok: true, model: modelId, providerId: providerId ?? agent.providerId };
            }

            if (action === 'toggle_mcp') {
                if (!mcpServerId) return { error: 'toggle_mcp 需要 mcpServerId' };
                const [target] = await db.select().from(mcpServers).where(eq(mcpServers.id, mcpServerId));
                if (!target || !target.enabled) return { error: 'MCP 服务器不存在或未启用' };
                if (enabled === false) {
                    await db.delete(agentMcpServers).where(and(eq(agentMcpServers.agentId, agentId), eq(agentMcpServers.mcpServerId, mcpServerId)));
                    return { ok: true, unbound: target.name };
                }
                await db.insert(agentMcpServers).values({ agentId, mcpServerId }).onConflictDoNothing();
                return { ok: true, bound: target.name };
            }

            if (action === 'toggle_tool') {
                if (!toolId) return { error: 'toggle_tool 需要 toolId' };
                const [target] = await db.select().from(tools).where(eq(tools.id, toolId));
                if (!target || !target.enabled) return { error: 'Tool 不存在或未启用' };
                if (enabled === false) {
                    await db.delete(agentTools).where(and(eq(agentTools.agentId, agentId), eq(agentTools.toolId, toolId)));
                    return { ok: true, unbound: target.name };
                }
                await db.insert(agentTools).values({ agentId, toolId }).onConflictDoNothing();
                return { ok: true, bound: target.name };
            }

            if (action === 'toggle_knowledge') {
                if (!kbId) return { error: 'toggle_knowledge 需要 kbId' };
                const [target] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
                if (!target) return { error: '知识库不存在' };
                if (enabled === false) {
                    await db.delete(agentKnowledgeBases).where(and(eq(agentKnowledgeBases.agentId, agentId), eq(agentKnowledgeBases.kbId, kbId)));
                    return { ok: true, unbound: target.name };
                }
                await db.insert(agentKnowledgeBases).values({ agentId, kbId }).onConflictDoNothing();
                return { ok: true, bound: target.name };
            }

            // toggle_skill
            if (!skillId) return { error: 'toggle_skill 需要 skillId' };
            const [target] = await db.select().from(skills).where(eq(skills.id, skillId));
            if (!target || !target.enabled) return { error: 'Skill 不存在或未启用' };
            if (enabled === false) {
                await db.delete(agentSkills).where(and(eq(agentSkills.agentId, agentId), eq(agentSkills.skillId, skillId)));
                return { ok: true, unbound: target.name };
            }
            await db.insert(agentSkills).values({ agentId, skillId }).onConflictDoNothing();
            return { ok: true, bound: target.name };
        },
    });
}
