import { eq, inArray } from 'drizzle-orm';
import { agentKnowledgeBases, agentMcpServers, agentSkills, agentTools, knowledgeBases, mcpServers, skills, tools } from '../db/schema';
import { db } from './db';

/**
 * 运行器：默认使用全局 db，调用方可传入 db.transaction 回调里的 tx，
 * 让「主表写入 + 四类能力绑定重建」处于同一事务，避免中途失败留下半更新状态。
 */
export type DbRunner = Pick<typeof db, 'select' | 'insert' | 'delete' | 'update'>;

/** 重建智能体与 Skill 的绑定关系。 */
export async function replaceAgentSkills(agentId: string, skillIds: string[], runner: DbRunner = db) {
    await runner.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
    if (skillIds.length) {
        const valid = await runner.select({ id: skills.id }).from(skills).where(inArray(skills.id, skillIds));
        if (valid.length) {
            await runner.insert(agentSkills).values(valid.map((s) => ({ agentId, skillId: s.id })));
        }
    }
}

/** 重建智能体与 Tool 的绑定关系。 */
export async function replaceAgentTools(agentId: string, toolIds: string[], runner: DbRunner = db) {
    await runner.delete(agentTools).where(eq(agentTools.agentId, agentId));
    if (toolIds.length) {
        const valid = await runner.select({ id: tools.id }).from(tools).where(inArray(tools.id, toolIds));
        if (valid.length) {
            await runner.insert(agentTools).values(valid.map((t) => ({ agentId, toolId: t.id })));
        }
    }
}

/** 重建智能体与知识库的绑定关系。 */
export async function replaceAgentKnowledgeBases(agentId: string, kbIds: string[], runner: DbRunner = db) {
    await runner.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, agentId));
    if (kbIds.length) {
        const valid = await runner.select({ id: knowledgeBases.id }).from(knowledgeBases).where(inArray(knowledgeBases.id, kbIds));
        if (valid.length) {
            await runner.insert(agentKnowledgeBases).values(valid.map((k) => ({ agentId, kbId: k.id })));
        }
    }
}

/** 重建智能体与 MCP 服务器的绑定关系。 */
export async function replaceAgentMcpServers(agentId: string, mcpServerIds: string[], runner: DbRunner = db) {
    await runner.delete(agentMcpServers).where(eq(agentMcpServers.agentId, agentId));
    if (mcpServerIds.length) {
        const valid = await runner.select({ id: mcpServers.id }).from(mcpServers).where(inArray(mcpServers.id, mcpServerIds));
        if (valid.length) {
            await runner.insert(agentMcpServers).values(valid.map((m) => ({ agentId, mcpServerId: m.id })));
        }
    }
}
