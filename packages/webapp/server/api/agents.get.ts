import { and, asc, eq, inArray } from 'drizzle-orm';
import { agentSkills, agents, skills } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

/**
 * 智能体广场列表。
 *
 * 技能绑定用一次 IN 查询取回后在内存分组，避免按 agent 逐个查询（N+1）：
 * 列表页的 agent 数量会随运营增长，逐个查会线性放大数据库往返。
 */
export default defineEventHandler(async (event) => {
    await requireUser(event);

    const rows = await db
        .select({
            id: agents.id,
            name: agents.name,
            emoji: agents.emoji,
            avatar: agents.avatar,
            description: agents.description,
        })
        .from(agents)
        .where(eq(agents.enabled, true))
        .orderBy(asc(agents.createdAt));

    if (!rows.length) return [];

    const bound = await db
        .select({ agentId: agentSkills.agentId, id: skills.id, name: skills.name })
        .from(agentSkills)
        .innerJoin(skills, eq(skills.id, agentSkills.skillId))
        .where(
            and(
                inArray(
                    agentSkills.agentId,
                    rows.map((row) => row.id),
                ),
                // 只列真正会生效的能力：chat.post.ts 加载技能时带 `skills.enabled = true`，
                // 这里漏掉该条件就会让广场卡片展示（并计入数量）运营已停用、模型永远拿不到的技能。
                eq(skills.enabled, true),
            ),
        );

    const byAgent = new Map<string, { id: string; name: string }[]>();
    for (const item of bound) {
        const list = byAgent.get(item.agentId) ?? [];
        list.push({ id: item.id, name: item.name });
        byAgent.set(item.agentId, list);
    }

    return rows.map((agent) => ({ ...agent, skills: byAgent.get(agent.id) ?? [] }));
});
