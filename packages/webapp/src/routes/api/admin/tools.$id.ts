import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { tools } from '@schema';
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';

type RouteParams = { request: Request; params: { id: string } };

const ToolPatchSchema = z.object({
    name: z.string().min(1).max(50).optional(),
    description: z.string().max(500).optional(),
    type: z.enum(['builtin_time', 'http']).optional(),
    config: z
        .object({
            url: z.string().max(1000).optional(),
            method: z.string().max(10).optional(),
            headers: z.record(z.string(), z.string()).optional(),
            bodyTemplate: z.string().max(4000).optional(),
            parameters: z.array(
                z.object({
                    name: z.string().min(1).max(50),
                    type: z.enum(['string', 'number', 'boolean']).default('string'),
                    description: z.string().max(200).optional(),
                    required: z.boolean().optional(),
                }),
            ).max(20).optional(),
        })
        .optional(),
    enabled: z.boolean().optional(),
});

export const Route = createFileRoute('/api/admin/tools/$id')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            PATCH: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '工具 ID');
                    const parsed = ToolPatchSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);

                    const [tool] = await db
                        .update(tools)
                        .set({ ...parsed.data, updatedAt: new Date() })
                        .where(eq(tools.id, id))
                        .returning();
                    if (!tool) throw new HttpError(404, '工具不存在');
                    return json(tool);
                } catch (e) {
                    return errorResponse(e);
                }
            },
            DELETE: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '工具 ID');
                    const deleted = await db.delete(tools).where(eq(tools.id, id)).returning({ id: tools.id });
                    if (deleted.length === 0) throw new HttpError(404, '工具不存在');
                    return json({ ok: true });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
