import { db } from '@/db';
import { errorResponse, HttpError, json, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { agentKnowledge, agentMcpServers, agents, agentSkills, agentTools, knowledgeBases, mcpServers, skills, tools } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { asc, inArray } from 'drizzle-orm';
import { z } from 'zod';

const AgentBodySchema = z.object({
    name: z.string().min(1).max(50),
    emoji: z.string().min(1).max(8).default('🤖'),
    description: z.string().max(500).default(''),
    systemPrompt: z.string().max(8000).default(''),
    // 内置供应商格式 "provider:model"（如 deepseek:deepseek-chat）；自定义供应商为裸模型 ID
    model: z
        .string()
        .regex(/^[a-z0-9._:-]+$/i, '模型 ID 只能包含字母数字与 . _ : -')
        .default('deepseek:deepseek-chat'),
    // 内置供应商（null）或自定义供应商 ID
    providerId: z.number().int().positive().nullable().default(null),
    enabled: z.boolean().default(true),
    skillIds: z.array(z.number().int().positive()).default([]),
    toolIds: z.array(z.number().int().positive()).default([]),
    knowledgeBaseIds: z.array(z.number().int().positive()).default([]),
    mcpServerIds: z.array(z.number().int().positive()).default([]),
});

export const Route = createFileRoute('/api/admin/agents')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const list = await db.select().from(agents).orderBy(asc(agents.id));
                    const skillLinks = await db.select().from(agentSkills);
                    const toolLinks = await db.select().from(agentTools);
                    const kbLinks = await db.select().from(agentKnowledge);
                    const mcpLinks = await db.select().from(agentMcpServers);
                    return json(
                        list.map((agent) => ({
                            ...agent,
                            skillIds: skillLinks.filter((l) => l.agentId === agent.id).map((l) => l.skillId),
                            toolIds: toolLinks.filter((l) => l.agentId === agent.id).map((l) => l.toolId),
                            knowledgeBaseIds: kbLinks.filter((l) => l.agentId === agent.id).map((l) => l.kbId),
                            mcpServerIds: mcpLinks.filter((l) => l.agentId === agent.id).map((l) => l.mcpServerId),
                        })),
                    );
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const parsed = AgentBodySchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const { skillIds, toolIds, knowledgeBaseIds, mcpServerIds, ...values } = parsed.data;

                    // 关联 id 存在性校验：避免 FK 约束失败留下孤儿数据
                    const assertIdsExist = async (label: string, ids: number[], existing: { id: number }[]) => {
                        if (ids.length === 0) return;
                        const found = new Set(existing.map((r) => r.id));
                        const missing = ids.filter((i) => !found.has(i));
                        if (missing.length > 0) throw new HttpError(400, `${label}不存在: ${missing.join(', ')}`);
                    };
                    await assertIdsExist('Skill', skillIds, await db.select({ id: skills.id }).from(skills).where(inArray(skills.id, skillIds)));
                    await assertIdsExist('Tool', toolIds, await db.select({ id: tools.id }).from(tools).where(inArray(tools.id, toolIds)));
                    await assertIdsExist(
                        '知识库',
                        knowledgeBaseIds,
                        await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(inArray(knowledgeBases.id, knowledgeBaseIds)),
                    );
                    await assertIdsExist(
                        'MCP 服务器',
                        mcpServerIds,
                        await db.select({ id: mcpServers.id }).from(mcpServers).where(inArray(mcpServers.id, mcpServerIds)),
                    );

                    // 建智能体与挂载关联放在同一事务中，避免中途失败留下孤儿数据
                    const created = await db.transaction(async (tx) => {
                        const agent = (await tx.insert(agents).values(values).returning())[0];
                        if (!agent) throw new HttpError(500, '创建智能体失败');
                        if (skillIds.length > 0) {
                            await tx.insert(agentSkills).values(skillIds.map((skillId) => ({ agentId: agent.id, skillId })));
                        }
                        if (toolIds.length > 0) {
                            await tx.insert(agentTools).values(toolIds.map((toolId) => ({ agentId: agent.id, toolId })));
                        }
                        if (knowledgeBaseIds.length > 0) {
                            await tx.insert(agentKnowledge).values(knowledgeBaseIds.map((kbId) => ({ agentId: agent.id, kbId })));
                        }
                        if (mcpServerIds.length > 0) {
                            await tx.insert(agentMcpServers).values(mcpServerIds.map((mcpServerId) => ({ agentId: agent.id, mcpServerId })));
                        }
                        return agent;
                    });
                    return json({ ...created, skillIds, toolIds, knowledgeBaseIds, mcpServerIds }, 201);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
