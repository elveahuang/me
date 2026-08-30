import { createFileRoute } from '@tanstack/react-router';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { agentSkills, agents } from '@schema';
import { errorResponse, HttpError, json, readJson, requireAdmin } from '@/lib/api';
import { MODEL_PRESETS } from '@/lib/ai';

const AgentBodySchema = z.object({
    name: z.string().min(1).max(50),
    emoji: z.string().min(1).max(8).default('🤖'),
    description: z.string().max(500).default(''),
    systemPrompt: z.string().max(8000).default(''),
    model: z
        .string()
        .regex(/^[a-z0-9-]+:[a-z0-9._-]+$/i, '模型格式应为 provider:model')
        .default(MODEL_PRESETS[0].id),
    enabled: z.boolean().default(true),
    skillIds: z.array(z.number().int().positive()).default([]),
});

export const Route = createFileRoute('/api/admin/agents')({
    server: {
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const list = await db.select().from(agents).orderBy(asc(agents.id));
                    const links = await db.select().from(agentSkills);
                    return json(
                        list.map((agent) => ({
                            ...agent,
                            skillIds: links.filter((l) => l.agentId === agent.id).map((l) => l.skillId),
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
                    const { skillIds, ...values } = parsed.data;

                    const [agent] = await db.insert(agents).values(values).returning();
                    if (!agent) throw new HttpError(500, '创建智能体失败');
                    if (skillIds.length > 0) {
                        await db.insert(agentSkills).values(skillIds.map((skillId) => ({ agentId: agent.id, skillId })));
                    }
                    return json({ ...agent, skillIds }, 201);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
