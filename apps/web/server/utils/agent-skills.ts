import { eq, inArray } from 'drizzle-orm';
import { agentKnowledgeBases, agentMcpServers, agentSkills, agentTools, knowledgeBases, mcpServers, skills, tools } from '../db/schema';
import { db } from './db';

/**
 * 运行器：默认使用全局 db，调用方可传入 db.transaction 回调里的 tx，
 * 让「主表写入 + 四类能力绑定重建」处于同一事务，避免中途失败留下半更新状态。
 */
export type DbRunner = Pick<typeof db, 'select' | 'insert' | 'delete' | 'update'>;

/**
 * 四条绑定重建共用同一个形状：先删旧行，再按传入 id 过滤出仍在的父行、插回子行。
 *
 * 那次过滤读必须带 `FOR SHARE`（与 `ref-lock.ts` 的 `lockProviderRow` 同一道理，只是父表换成了
 * 能力四张表）：调用方给的全是 uuid，客户端手填、或读到的列表与本次保存之间被别的管理员删掉，
 * 都会让「校验通过 → 插子行」之间留出真实窗口，插子行撞外键 23503 变成 500，
 * 响应体里连 `insert into "agent_skills" ...` 的整条语句一起带出去。
 * 这些父行的 DELETE（`settings/{skills,tools,mcp-servers,knowledge-bases}` 的删除分支）没有配套的行锁，
 * 所以只有子插入这一侧取锁才关得上窗口：`FOR SHARE` 与删除侧互斥、与并发子插入相容。
 *
 * 读不到父行时保持原有语义——静默少绑一条，而不是整次保存失败：
 * 智能体保存的是「这些能力里仍在的那些」，为一条已被删掉的能力回 409 只会让用户以为自己的点击坏了。
 */

/** 重建智能体与 Skill 的绑定关系。 */
export async function replaceAgentSkills(agentId: string, skillIds: string[], runner: DbRunner = db) {
    await runner.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
    if (skillIds.length) {
        const valid = await runner.select({ id: skills.id }).from(skills).where(inArray(skills.id, skillIds)).for('share');
        if (valid.length) {
            await runner.insert(agentSkills).values(valid.map((s) => ({ agentId, skillId: s.id })));
        }
    }
}

/** 重建智能体与 Tool 的绑定关系。 */
export async function replaceAgentTools(agentId: string, toolIds: string[], runner: DbRunner = db) {
    await runner.delete(agentTools).where(eq(agentTools.agentId, agentId));
    if (toolIds.length) {
        const valid = await runner.select({ id: tools.id }).from(tools).where(inArray(tools.id, toolIds)).for('share');
        if (valid.length) {
            await runner.insert(agentTools).values(valid.map((t) => ({ agentId, toolId: t.id })));
        }
    }
}

/** 重建智能体与知识库的绑定关系。 */
export async function replaceAgentKnowledgeBases(agentId: string, kbIds: string[], runner: DbRunner = db) {
    await runner.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, agentId));
    if (kbIds.length) {
        const valid = await runner.select({ id: knowledgeBases.id }).from(knowledgeBases).where(inArray(knowledgeBases.id, kbIds)).for('share');
        if (valid.length) {
            await runner.insert(agentKnowledgeBases).values(valid.map((k) => ({ agentId, kbId: k.id })));
        }
    }
}

/** 重建智能体与 MCP 服务器的绑定关系。 */
export async function replaceAgentMcpServers(agentId: string, mcpServerIds: string[], runner: DbRunner = db) {
    await runner.delete(agentMcpServers).where(eq(agentMcpServers.agentId, agentId));
    if (mcpServerIds.length) {
        const valid = await runner.select({ id: mcpServers.id }).from(mcpServers).where(inArray(mcpServers.id, mcpServerIds)).for('share');
        if (valid.length) {
            await runner.insert(agentMcpServers).values(valid.map((m) => ({ agentId, mcpServerId: m.id })));
        }
    }
}
