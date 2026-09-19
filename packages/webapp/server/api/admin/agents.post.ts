import { eq } from 'drizzle-orm';
import { agents } from '../../db/schema';
import { replaceAgentKnowledgeBases, replaceAgentMcpServers, replaceAgentSkills, replaceAgentTools } from '../../utils/agent-skills';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { assertProviderExists } from '../../utils/providers';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const body = (await readBody(event)) ?? {};
    if (!body.name) {
        throw createError({ statusCode: 400, statusMessage: 'name is required' });
    }
    const providerId = await assertProviderExists(body.providerId);

    const id = crypto.randomUUID();
    // 主表插入与四类能力绑定重建放在同一事务：任一绑定写入失败即整体回滚，
    // 不会残留一个缺少绑定、或绑定了不存在实体的半成品智能体。
    await db.transaction(async (tx) => {
        await tx.insert(agents).values({
            id,
            name: body.name,
            emoji: body.emoji ?? '🤖',
            avatar: body.avatar ?? null,
            description: body.description ?? '',
            systemPrompt: body.systemPrompt ?? '',
            model: body.model ?? 'deepseek-chat',
            providerId,
            selfConfig: body.selfConfig ?? false,
            enabled: body.enabled ?? true,
            temperature: body.temperature !== undefined ? body.temperature : 0.7,
            maxTokens: body.maxTokens !== undefined ? body.maxTokens : null,
            maxSteps: body.maxSteps !== undefined ? body.maxSteps : 6,
        });
        await replaceAgentSkills(id, body.skillIds ?? [], tx);
        await replaceAgentTools(id, body.toolIds ?? [], tx);
        await replaceAgentKnowledgeBases(id, body.kbIds ?? [], tx);
        await replaceAgentMcpServers(id, body.mcpIds ?? [], tx);
    });

    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    return row;
});
