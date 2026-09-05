import { db } from '@/db';
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { skills } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

type RouteParams = { request: Request; params: { id: string } };

const SkillPatchSchema = z.object({
    name: z.string().min(1).max(50).optional(),
    description: z.string().max(500).optional(),
    instructions: z.string().min(1).max(8000).optional(),
    enabled: z.boolean().optional(),
});

export const Route = createFileRoute('/api/admin/skills/$id')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            PATCH: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, 'Skill ID');
                    const parsed = SkillPatchSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);

                    const [skill] = await db
                        .update(skills)
                        .set({ ...parsed.data, updatedAt: new Date() })
                        .where(eq(skills.id, id))
                        .returning();
                    if (!skill) throw new HttpError(404, 'Skill 不存在');
                    return json(skill);
                } catch (e) {
                    return errorResponse(e);
                }
            },
            DELETE: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, 'Skill ID');
                    const deleted = await db.delete(skills).where(eq(skills.id, id)).returning({ id: skills.id });
                    if (deleted.length === 0) throw new HttpError(404, 'Skill 不存在');
                    return json({ ok: true });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
