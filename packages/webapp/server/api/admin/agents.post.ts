import { eq } from 'drizzle-orm';
import { agents } from '../../db/schema';
import {
    normalizeAgentIdList,
    normalizeAgentMaxSteps,
    normalizeAgentMaxTokens,
    normalizeAgentModel,
    normalizeAgentName,
    normalizeAgentTemperature,
    normalizeAgentText,
} from '../../utils/admin-agent-input';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { replaceAgentKnowledgeBases, replaceAgentMcpServers, replaceAgentSkills, replaceAgentTools } from '../../utils/agent-skills';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { assertProviderExists } from '../../utils/providers';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const body = (await readBody(event)) ?? {};
    const name = normalizeAgentName(body.name);
    const providerId = await assertProviderExists(body.providerId);

    const id = crypto.randomUUID();
    // 主表插入与四类能力绑定重建放在同一事务：任一绑定写入失败即整体回滚，
    // 不会残留一个缺少绑定、或绑定了不存在实体的半成品智能体。
    await db.transaction(async (tx) => {
        await tx.insert(agents).values({
            id,
            name,
            emoji: normalizeAgentText(body.emoji, 'emoji', 32) ?? '🤖',
            avatar: normalizeAgentText(body.avatar, 'avatar', 500),
            description: normalizeAgentText(body.description, 'description', 500) ?? '',
            systemPrompt: normalizeAgentText(body.systemPrompt, 'systemPrompt', 20000) ?? '',
            model: normalizeAgentModel(body.model),
            providerId,
            selfConfig: normalizeAdminBoolean(body.selfConfig, 'selfConfig', false),
            enabled: normalizeAdminBoolean(body.enabled, 'enabled', true),
            temperature: normalizeAgentTemperature(body.temperature, 0.7),
            maxTokens: normalizeAgentMaxTokens(body.maxTokens),
            maxSteps: normalizeAgentMaxSteps(body.maxSteps, 6),
        });
        await replaceAgentSkills(id, normalizeAgentIdList(body.skillIds, 'skillIds'), tx);
        await replaceAgentTools(id, normalizeAgentIdList(body.toolIds, 'toolIds'), tx);
        await replaceAgentKnowledgeBases(id, normalizeAgentIdList(body.kbIds, 'kbIds'), tx);
        await replaceAgentMcpServers(id, normalizeAgentIdList(body.mcpIds, 'mcpIds'), tx);
    });

    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    return row;
});
