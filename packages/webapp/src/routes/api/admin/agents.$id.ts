import { db } from '@/db';
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { agentKnowledge, agentMcpServers, agents, agentSkills, agentTools, knowledgeBases, mcpServers, skills, tools } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

type RouteParams = { request: Request; params: { id: string } };

const AgentPatchSchema = z.object({
    name: z.string().min(1).max(50).optional(),
    emoji: z.string().min(1).max(8).optional(),
    description: z.string().max(500).optional(),
    systemPrompt: z.string().max(8000).optional(),
    // 内置供应商格式 "provider:model"（如 deepseek:deepseek-chat）；自定义供应商为裸模型 ID
    model: z
        .string()
        .regex(/^[a-z0-9._:-]+$/i, '模型 ID 只能包含字母数字与 . _ : -')
        .optional(),
    providerId: z.number().int().positive().nullable().optional(),
    enabled: z.boolean().optional(),
    skillIds: z.array(z.number().int().positive()).optional(),
    toolIds: z.array(z.number().int().positive()).optional(),
    knowledgeBaseIds: z.array(z.number().int().positive()).optional(),
    mcpServerIds: z.array(z.number().int().positive()).optional(),
});

export const Route = createFileRoute('/api/admin/agents/$id')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            PATCH: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '智能体 ID');
                    const parsed = AgentPatchSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const { skillIds, toolIds, knowledgeBaseIds, mcpServerIds, ...values } = parsed.data;

                    // 关联 id 存在性校验：避免 FK 约束在事务中触发导致整体失败
                    const assertIdsExist = async (label: string, ids: number[], existing: { id: number }[]) => {
                        if (ids.length === 0) return;
                        const found = new Set(existing.map((r) => r.id));
                        const missing = ids.filter((i) => !found.has(i));
                        if (missing.length > 0) throw new HttpError(400, `${label}不存在: ${missing.join(', ')}`);
                    };

                    const agent = (
                        await db
                            .update(agents)
                            .set({ ...values, updatedAt: new Date() })
                            .where(eq(agents.id, id))
                            .returning()
                    )[0];
                    if (!agent) throw new HttpError(404, '智能体不存在');

                    if (skillIds) await assertIdsExist('Skill', skillIds, await db.select({ id: skills.id }).from(skills).where(inArray(skills.id, skillIds)));
                    if (toolIds) await assertIdsExist('Tool', toolIds, await db.select({ id: tools.id }).from(tools).where(inArray(tools.id, toolIds)));
                    if (knowledgeBaseIds)
                        await assertIdsExist(
                            '知识库',
                            knowledgeBaseIds,
                            await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(inArray(knowledgeBases.id, knowledgeBaseIds)),
                        );
                    if (mcpServerIds)
                        await assertIdsExist(
                            'MCP 服务器',
                            mcpServerIds,
                            await db.select({ id: mcpServers.id }).from(mcpServers).where(inArray(mcpServers.id, mcpServerIds)),
                        );

                    // 删旧建新放在同一事务中，避免中途失败导致挂载被清空
                    await db.transaction(async (tx) => {
                        if (skillIds) {
                            await tx.delete(agentSkills).where(eq(agentSkills.agentId, id));
                            if (skillIds.length > 0) {
                                await tx.insert(agentSkills).values(skillIds.map((skillId) => ({ agentId: id, skillId })));
                            }
                        }
                        if (toolIds) {
                            await tx.delete(agentTools).where(eq(agentTools.agentId, id));
                            if (toolIds.length > 0) {
                                await tx.insert(agentTools).values(toolIds.map((toolId) => ({ agentId: id, toolId })));
                            }
                        }
                        if (knowledgeBaseIds) {
                            await tx.delete(agentKnowledge).where(eq(agentKnowledge.agentId, id));
                            if (knowledgeBaseIds.length > 0) {
                                await tx.insert(agentKnowledge).values(knowledgeBaseIds.map((kbId) => ({ agentId: id, kbId })));
                            }
                        }
                        if (mcpServerIds) {
                            await tx.delete(agentMcpServers).where(eq(agentMcpServers.agentId, id));
                            if (mcpServerIds.length > 0) {
                                await tx.insert(agentMcpServers).values(mcpServerIds.map((mcpServerId) => ({ agentId: id, mcpServerId })));
                            }
                        }
                    });

                    const skillLinks = await db.select().from(agentSkills).where(eq(agentSkills.agentId, id));
                    const toolLinks = await db.select().from(agentTools).where(eq(agentTools.agentId, id));
                    const kbLinks = await db.select().from(agentKnowledge).where(eq(agentKnowledge.agentId, id));
                    const mcpLinks = await db.select().from(agentMcpServers).where(eq(agentMcpServers.agentId, id));
                    return json({
                        ...agent,
                        skillIds: skillLinks.map((l) => l.skillId),
                        toolIds: toolLinks.map((l) => l.toolId),
                        knowledgeBaseIds: kbLinks.map((l) => l.kbId),
                        mcpServerIds: mcpLinks.map((l) => l.mcpServerId),
                    });
                } catch (e) {
                    return errorResponse(e);
                }
            },
            DELETE: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '智能体 ID');
                    const deleted = await db.delete(agents).where(eq(agents.id, id)).returning({ id: agents.id });
                    if (deleted.length === 0) throw new HttpError(404, '智能体不存在');
                    return json({ ok: true });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
