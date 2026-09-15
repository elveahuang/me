import { eq, inArray } from 'drizzle-orm';
import { agentKnowledgeBases, agentMcpServers, agentSkills, agentTools, knowledgeBases, mcpServers, skills, tools } from '../db/schema';
import { db } from './db';

/** 重建智能体与 Skill 的绑定关系。 */
export async function replaceAgentSkills(agentId: string, skillIds: string[]) {
    await db.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
    if (skillIds.length) {
        const valid = await db.select({ id: skills.id }).from(skills).where(inArray(skills.id, skillIds));
        if (valid.length) {
            await db.insert(agentSkills).values(valid.map((s) => ({ agentId, skillId: s.id })));
        }
    }
}

/** 重建智能体与 Tool 的绑定关系。 */
export async function replaceAgentTools(agentId: string, toolIds: string[]) {
    await db.delete(agentTools).where(eq(agentTools.agentId, agentId));
    if (toolIds.length) {
        const valid = await db.select({ id: tools.id }).from(tools).where(inArray(tools.id, toolIds));
        if (valid.length) {
            await db.insert(agentTools).values(valid.map((t) => ({ agentId, toolId: t.id })));
        }
    }
}

/** 重建智能体与知识库的绑定关系。 */
export async function replaceAgentKnowledgeBases(agentId: string, kbIds: string[]) {
    await db.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, agentId));
    if (kbIds.length) {
        const valid = await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(inArray(knowledgeBases.id, kbIds));
        if (valid.length) {
            await db.insert(agentKnowledgeBases).values(valid.map((k) => ({ agentId, kbId: k.id })));
        }
    }
}

/** 重建智能体与 MCP 服务器的绑定关系。 */
export async function replaceAgentMcpServers(agentId: string, mcpServerIds: string[]) {
    await db.delete(agentMcpServers).where(eq(agentMcpServers.agentId, agentId));
    if (mcpServerIds.length) {
        const valid = await db.select({ id: mcpServers.id }).from(mcpServers).where(inArray(mcpServers.id, mcpServerIds));
        if (valid.length) {
            await db.insert(agentMcpServers).values(valid.map((m) => ({ agentId, mcpServerId: m.id })));
        }
    }
}
