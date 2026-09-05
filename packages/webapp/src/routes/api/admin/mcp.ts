import { db } from '@/db';
import { errorResponse, HttpError, json, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { mcpServers } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { asc } from 'drizzle-orm';
import { z } from 'zod';

const McpBodySchema = z
    .object({
        name: z.string().min(1).max(50),
        description: z.string().max(500).default(''),
        transport: z.enum(['http', 'sse', 'stdio']).default('http'),
        url: z.string().url().max(500).nullable().optional(),
        command: z.string().max(300).nullable().optional(),
        args: z.array(z.string().max(500)).max(30).nullable().optional(),
        env: z.record(z.string(), z.string().max(500)).nullable().optional(),
        enabled: z.boolean().default(true),
    })
    .refine((v) => (v.transport === 'stdio' ? Boolean(v.command) : Boolean(v.url)), {
        message: 'http/sse 传输必须填写 URL，stdio 传输必须填写命令',
    });

export const Route = createFileRoute('/api/admin/mcp')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const list = await db.select().from(mcpServers).orderBy(asc(mcpServers.id));
                    return json(list);
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const parsed = McpBodySchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const [server] = await db.insert(mcpServers).values(parsed.data).returning();
                    if (!server) throw new HttpError(500, '创建 MCP 服务器失败');
                    return json(server, 201);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
