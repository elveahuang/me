import { eq } from 'drizzle-orm';
import { agents } from '../../../db/schema';
import { replaceAgentKnowledgeBases, replaceAgentMcpServers, replaceAgentSkills, replaceAgentTools } from '../../../utils/agent-skills';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const body = (await readBody(event)) ?? {};

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'emoji', 'avatar', 'description', 'systemPrompt', 'model', 'enabled', 'temperature', 'maxTokens', 'maxSteps'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.selfConfig !== undefined) patch.selfConfig = body.selfConfig;
    if (body.providerId !== undefined) patch.providerId = body.providerId || null;

    // 主表更新与绑定重建同事务：patch 恒带 updatedAt，故 update 返回 0 行即智能体不存在，
    // 此时必须在写入绑定之前抛错回滚——否则给不存在的 agentId 建绑定会触发外键约束 500。
    await db.transaction(async (tx) => {
        const [updated] = await tx.update(agents).set(patch).where(eq(agents.id, id)).returning({ id: agents.id });
        if (!updated) throw createError({ statusCode: 404, statusMessage: '智能体不存在' });

        if (body.skillIds) await replaceAgentSkills(id, body.skillIds, tx);
        if (body.toolIds) await replaceAgentTools(id, body.toolIds, tx);
        if (body.kbIds) await replaceAgentKnowledgeBases(id, body.kbIds, tx);
        if (body.mcpIds) await replaceAgentMcpServers(id, body.mcpIds, tx);
    });

    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '智能体不存在' });
    return row;
});
