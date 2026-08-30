import { createFileRoute } from '@tanstack/react-router';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { tools } from '@schema';
import { errorResponse, HttpError, json, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';

const ParameterSchema = z.object({
    name: z.string().min(1).max(50),
    type: z.enum(['string', 'number', 'boolean']).default('string'),
    description: z.string().max(200).optional(),
    required: z.boolean().optional(),
});

const ToolBodySchema = z.object({
    name: z.string().min(1).max(50),
    description: z.string().max(500).default(''),
    type: z.enum(['builtin_time', 'http']).default('builtin_time'),
    config: z
        .object({
            url: z.string().max(1000).optional(),
            method: z.string().max(10).optional(),
            headers: z.record(z.string(), z.string()).optional(),
            bodyTemplate: z.string().max(4000).optional(),
            parameters: z.array(ParameterSchema).max(20).optional(),
        })
        .default({}),
    enabled: z.boolean().default(true),
});

export const Route = createFileRoute('/api/admin/tools')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const list = await db.select().from(tools).orderBy(asc(tools.id));
                    return json(list);
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const parsed = ToolBodySchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    if (parsed.data.type === 'http' && !parsed.data.config.url) {
                        throw new HttpError(400, 'HTTP 工具必须填写 URL');
                    }
                    const [tool] = await db.insert(tools).values(parsed.data).returning();
                    if (!tool) throw new HttpError(500, '创建工具失败');
                    return json(tool, 201);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
