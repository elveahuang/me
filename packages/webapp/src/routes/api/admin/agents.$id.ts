import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { agentSkills, agents } from '@schema';
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from '@/lib/api';

type RouteParams = { request: Request; params: { id: string } };

const AgentPatchSchema = z.object({
    name: z.string().min(1).max(50).optional(),
    emoji: z.string().min(1).max(8).optional(),
    description: z.string().max(500).optional(),
    systemPrompt: z.string().max(8000).optional(),
    model: z
        .string()
        .regex(/^[a-z0-9-]+:[a-z0-9._-]+$/i, '模型格式应为 provider:model')
        .optional(),
    enabled: z.boolean().optional(),
    skillIds: z.array(z.number().int().positive()).optional(),
});

export const Route = createFileRoute('/api/admin/agents/$id')({
    server: {
        handlers: {
            PATCH: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '智能体 ID');
                    const parsed = AgentPatchSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const { skillIds, ...values } = parsed.data;

                    const [agent] = await db
                        .update(agents)
                        .set({ ...values, updatedAt: new Date() })
                        .where(eq(agents.id, id))
                        .returning();
                    if (!agent) throw new HttpError(404, '智能体不存在');

                    if (skillIds) {
                        await db.delete(agentSkills).where(eq(agentSkills.agentId, id));
                        if (skillIds.length > 0) {
                            await db.insert(agentSkills).values(skillIds.map((skillId) => ({ agentId: id, skillId })));
                        }
                    }

                    const links = await db.select().from(agentSkills).where(eq(agentSkills.agentId, id));
                    return json({ ...agent, skillIds: links.map((l) => l.skillId) });
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
