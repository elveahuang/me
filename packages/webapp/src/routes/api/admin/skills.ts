import { createFileRoute } from '@tanstack/react-router';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { skills } from '@schema';
import { errorResponse, HttpError, json, readJson, requireAdmin } from '@/lib/api';

const SkillBodySchema = z.object({
    name: z.string().min(1).max(50),
    description: z.string().max(500).default(''),
    instructions: z.string().min(1).max(8000),
    enabled: z.boolean().default(true),
});

export const Route = createFileRoute('/api/admin/skills')({
    server: {
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const list = await db.select().from(skills).orderBy(asc(skills.id));
                    return json(list);
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const parsed = SkillBodySchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const [skill] = await db.insert(skills).values(parsed.data).returning();
                    return json(skill, 201);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
