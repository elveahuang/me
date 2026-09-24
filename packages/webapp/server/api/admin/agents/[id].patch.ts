import { eq } from 'drizzle-orm';
import { agents } from '../../../db/schema';
import {
    normalizeAgentIdList,
    normalizeAgentMaxSteps,
    normalizeAgentMaxTokens,
    normalizeAgentModel,
    normalizeAgentName,
    normalizeAgentTemperature,
    normalizeAgentText,
} from '../../../utils/admin-agent-input';
import { normalizeAdminBoolean } from '../../../utils/admin-boolean';
import { replaceAgentKnowledgeBases, replaceAgentMcpServers, replaceAgentSkills, replaceAgentTools } from '../../../utils/agent-skills';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { assertProviderExists } from '../../../utils/providers';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const body = (await readBody(event)) ?? {};

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = normalizeAgentName(body.name);
    if (body.emoji !== undefined) patch.emoji = normalizeAgentText(body.emoji, 'emoji', 32) ?? '🤖';
    if (body.avatar !== undefined) patch.avatar = normalizeAgentText(body.avatar, 'avatar', 500);
    if (body.description !== undefined) patch.description = normalizeAgentText(body.description, 'description', 500) ?? '';
    if (body.systemPrompt !== undefined) patch.systemPrompt = normalizeAgentText(body.systemPrompt, 'systemPrompt', 20000) ?? '';
    if (body.model !== undefined) patch.model = normalizeAgentModel(body.model);
    if (body.enabled !== undefined) patch.enabled = normalizeAdminBoolean(body.enabled, 'enabled', true);
    if (body.temperature !== undefined) patch.temperature = normalizeAgentTemperature(body.temperature, 0.7);
    if (body.maxTokens !== undefined) patch.maxTokens = normalizeAgentMaxTokens(body.maxTokens);
    if (body.maxSteps !== undefined) patch.maxSteps = normalizeAgentMaxSteps(body.maxSteps, 6);
    if (body.selfConfig !== undefined) patch.selfConfig = normalizeAdminBoolean(body.selfConfig, 'selfConfig', false);
    if (body.providerId !== undefined) patch.providerId = await assertProviderExists(body.providerId);

    // 主表更新与绑定重建同事务：patch 恒带 updatedAt，故 update 返回 0 行即智能体不存在，
    // 此时必须在写入绑定之前抛错回滚——否则给不存在的 agentId 建绑定会触发外键约束 500。
    await db.transaction(async (tx) => {
        const [updated] = await tx.update(agents).set(patch).where(eq(agents.id, id)).returning({ id: agents.id });
        if (!updated) throw createError({ statusCode: 404, statusMessage: '智能体不存在' });

        // 保留原本的 truthiness 门（未传/null 即不动绑定），但列表内容必须归一后再交给 inArray
        if (body.skillIds) await replaceAgentSkills(id, normalizeAgentIdList(body.skillIds, 'skillIds'), tx);
        if (body.toolIds) await replaceAgentTools(id, normalizeAgentIdList(body.toolIds, 'toolIds'), tx);
        if (body.kbIds) await replaceAgentKnowledgeBases(id, normalizeAgentIdList(body.kbIds, 'kbIds'), tx);
        if (body.mcpIds) await replaceAgentMcpServers(id, normalizeAgentIdList(body.mcpIds, 'mcpIds'), tx);
    });

    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '智能体不存在' });
    return row;
});
