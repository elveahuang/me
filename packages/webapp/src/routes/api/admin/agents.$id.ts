import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { agentMcpServers, agentSkills, agentTools, agentKnowledge, agents } from '@schema';
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';

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

                    const agent = (
                        await db
                            .update(agents)
                            .set({ ...values, updatedAt: new Date() })
                            .where(eq(agents.id, id))
                            .returning()
                    )[0];
                    if (!agent) throw new HttpError(404, '智能体不存在');

                    if (skillIds) {
                        await db.delete(agentSkills).where(eq(agentSkills.agentId, id));
                        if (skillIds.length > 0) {
                            await db.insert(agentSkills).values(skillIds.map((skillId) => ({ agentId: id, skillId })));
                        }
                    }
                    if (toolIds) {
                        await db.delete(agentTools).where(eq(agentTools.agentId, id));
                        if (toolIds.length > 0) {
                            await db.insert(agentTools).values(toolIds.map((toolId) => ({ agentId: id, toolId })));
                        }
                    }
                    if (knowledgeBaseIds) {
                        await db.delete(agentKnowledge).where(eq(agentKnowledge.agentId, id));
                        if (knowledgeBaseIds.length > 0) {
                            await db.insert(agentKnowledge).values(knowledgeBaseIds.map((kbId) => ({ agentId: id, kbId })));
                        }
                    }
                    if (mcpServerIds) {
                        await db.delete(agentMcpServers).where(eq(agentMcpServers.agentId, id));
                        if (mcpServerIds.length > 0) {
                            await db.insert(agentMcpServers).values(mcpServerIds.map((mcpServerId) => ({ agentId: id, mcpServerId })));
                        }
                    }

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
