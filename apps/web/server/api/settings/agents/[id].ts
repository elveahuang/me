import { eq, sql } from 'drizzle-orm';
import { agents, conversations } from '../../../db/schema';
import {
    normalizeAgentApprovalMode,
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
import { requireMethod } from '../../../utils/method';
import { assertProviderExists } from '../../../utils/providers';
import { flagParam } from '../../../utils/query';
import { lockProviderRow } from '../../../utils/ref-lock';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

export default defineEventHandler(async (event) => {
    const method = requireMethod(event, ['DELETE', 'PATCH']);
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    const id = routeId(event, 'id', '智能体');

    if (method === 'DELETE') {
        // 会话与消息对智能体是 `onDelete: 'cascade'`：一次 id 抄错的删除会把该智能体的全部聊天记录一起带走，
        // 且工作台没有任何回收路径（没有备份表、没有软删）。所以照 `settings/storage/[id].ts` 的先例改成
        // 「先数引用、默认阻止、要 force 才继续」。
        // 数与删必须在同一事务里、并对智能体行取 FOR UPDATE：否则「数完」与「删掉」之间
        // 并发的一轮 /api/chat 能新建一条会话，那条会话就绕过闸门被级联掉。
        // 新会话插入时会对父行取 FOR KEY SHARE，正好与这把锁互斥，窗口因此关死。
        const force = flagParam(getQuery(event).force);
        await db.transaction(async (tx) => {
            const [locked] = await tx.select({ id: agents.id }).from(agents).where(eq(agents.id, id)).for('update');
            // 0 行影响也要报出来：否则 id 抄错或行已被另一个管理员删掉时，界面照样提示「已删除」
            if (!locked) throw createError({ statusCode: 404, statusMessage: '智能体不存在' });
            if (!force) {
                const [usage] = await tx
                    .select({ count: sql<number>`count(*)::int` })
                    .from(conversations)
                    .where(eq(conversations.agentId, id));
                if (usage?.count) {
                    throw createError({
                        statusCode: 409,
                        statusMessage: `该智能体下还有 ${usage.count} 条会话，删除会连同聊天历史一起清空；确认后可加 ?force=1 强制删除`,
                    });
                }
            }
            await tx.delete(agents).where(eq(agents.id, id));
        });
        return { ok: true };
    }

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
    if (body.approvalMode !== undefined) patch.approvalMode = normalizeAgentApprovalMode(body.approvalMode);
    if (body.selfConfig !== undefined) patch.selfConfig = normalizeAdminBoolean(body.selfConfig, 'selfConfig', false);
    if (body.providerId !== undefined) patch.providerId = await assertProviderExists(body.providerId);

    // 主表更新与绑定重建同事务：patch 恒带 updatedAt，故 update 返回 0 行即智能体不存在，
    // 此时必须在写入绑定之前抛错回滚——否则给不存在的 agentId 建绑定会触发外键约束 500。
    await db.transaction(async (tx) => {
        // 与 POST 同一道锁：`assertProviderExists()` 的那次读在事务外，窗口里供应商可以被删掉，
        // 这条 UPDATE 随即撞 23503 变成 500 + SQL 原文（父行 → 子行的加锁顺序与删除侧一致，不会互锁）。
        if (typeof patch.providerId === 'string') await lockProviderRow(tx, patch.providerId);
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
