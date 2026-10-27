import { desc, eq } from 'drizzle-orm';
import type { H3Event } from 'h3';
import { agentKnowledgeBases, agentMcpServers, agentSkills, agentTools, agents, knowledgeBases, mcpServers, providers, skills, tools } from '../../db/schema';
import {
    normalizeAgentApprovalMode,
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
import { requireMethod } from '../../utils/method';
import { assertProviderExists } from '../../utils/providers';
import { lockProviderRow } from '../../utils/ref-lock';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../utils/request-body';

async function createAgent(event: H3Event) {
    const body = (await readBody(event)) ?? {};
    const name = normalizeAgentName(body.name);
    const providerId = await assertProviderExists(body.providerId);

    const id = crypto.randomUUID();
    // 主表插入与四类能力绑定重建放在同一事务：任一绑定写入失败即整体回滚，
    // 不会残留一个缺少绑定、或绑定了不存在实体的半成品智能体。
    await db.transaction(async (tx) => {
        // 供应商存在性是 `assertProviderExists()` 在事务外查的，窗口里那行可以被删掉；
        // 在这里对父行重新取锁，既补上判定，也让「删除供应商」排到本次写入之后。
        if (providerId) await lockProviderRow(tx, providerId);
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
            approvalMode: normalizeAgentApprovalMode(body.approvalMode),
        });
        await replaceAgentSkills(id, normalizeAgentIdList(body.skillIds, 'skillIds'), tx);
        await replaceAgentTools(id, normalizeAgentIdList(body.toolIds, 'toolIds'), tx);
        await replaceAgentKnowledgeBases(id, normalizeAgentIdList(body.kbIds, 'kbIds'), tx);
        await replaceAgentMcpServers(id, normalizeAgentIdList(body.mcpIds, 'mcpIds'), tx);
    });

    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    // 提交后仍可能被并发删除（另一个标签页正好删掉这条），此时必须报错而不是回 undefined：
    // 未判空会让响应类型多出 undefined，前端 `data.id` 直接抛错，界面上是「保存失败」但数据其实写进去了。
    if (!row) throw createError({ statusCode: 404, statusMessage: '智能体不存在' });
    return row;
}

export default defineEventHandler(async (event) => {
    const method = requireMethod(event, ['GET', 'POST']);
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    if (method === 'POST') return createAgent(event);

    const rows = await db.select().from(agents).orderBy(desc(agents.createdAt));
    const allSkills = await db.select().from(skills);
    const allTools = await db.select().from(tools);
    const bindings = await db.select().from(agentSkills);
    const toolBindings = await db.select().from(agentTools);
    const kbBindings = await db.select().from(agentKnowledgeBases);
    const allKbs = await db.select({ id: knowledgeBases.id, name: knowledgeBases.name }).from(knowledgeBases);
    const mcpBindings = await db.select().from(agentMcpServers);
    const allMcp = await db.select({ id: mcpServers.id, name: mcpServers.name }).from(mcpServers);
    const providerRows = await db.select({ id: providers.id, name: providers.name, models: providers.models }).from(providers);

    // 预分组，避免对每个 agent 遍历全部绑定并对每条绑定 .find（O(agents × bindings)）：
    // 按 agentId 建一次索引，实体表按 id 建 Map，列表组装退化为线性拼接。
    const skillsById = new Map(allSkills.map((s) => [s.id, s]));
    const toolsById = new Map(allTools.map((t) => [t.id, t]));
    const providerById = new Map(providerRows.map((p) => [p.id, p]));
    const groupAgentIds = <T extends { agentId: string }>(list: T[], key: (row: T) => string) => {
        const map = new Map<string, string[]>();
        for (const row of list) {
            const value = key(row);
            const bucket = map.get(row.agentId);
            if (bucket) bucket.push(value);
            else map.set(row.agentId, [value]);
        }
        return map;
    };
    const skillIdsByAgent = groupAgentIds(bindings, (b) => b.skillId);
    const toolIdsByAgent = groupAgentIds(toolBindings, (b) => b.toolId);
    const kbIdsByAgent = groupAgentIds(kbBindings, (b) => b.kbId);
    const mcpIdsByAgent = groupAgentIds(mcpBindings, (b) => b.mcpServerId);
    const kbById = new Map(allKbs.map((k) => [k.id, k]));
    const mcpById = new Map(allMcp.map((m) => [m.id, m]));
    const pick = <T>(ids: string[] | undefined, byId: Map<string, T>) => (ids ?? []).map((id) => byId.get(id)).filter((v): v is T => Boolean(v));

    return rows.map((agent) => {
        const skillIds = skillIdsByAgent.get(agent.id) ?? [];
        const toolIds = toolIdsByAgent.get(agent.id) ?? [];
        const kbIds = kbIdsByAgent.get(agent.id) ?? [];
        const mcpIds = mcpIdsByAgent.get(agent.id) ?? [];
        return {
            ...agent,
            skillIds,
            skills: pick(skillIds, skillsById),
            toolIds,
            tools: pick(toolIds, toolsById),
            kbIds,
            knowledgeBases: pick(kbIds, kbById),
            mcpIds,
            mcpServers: pick(mcpIds, mcpById),
            provider: agent.providerId ? (providerById.get(agent.providerId) ?? null) : null,
        };
    });
});
