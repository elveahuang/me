import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { mcpServers } from '@schema';
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';

type RouteParams = { request: Request; params: { id: string } };

const McpPatchSchema = z.object({
    name: z.string().min(1).max(50).optional(),
    description: z.string().max(500).optional(),
    transport: z.enum(['http', 'sse', 'stdio']).optional(),
    url: z.string().url().max(500).nullable().optional(),
    command: z.string().max(300).nullable().optional(),
    args: z.array(z.string().max(500)).max(30).nullable().optional(),
    env: z.record(z.string(), z.string().max(500)).nullable().optional(),
    enabled: z.boolean().optional(),
});

export const Route = createFileRoute('/api/admin/mcp/$id')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            PATCH: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, 'MCP 服务器 ID');
                    const parsed = McpPatchSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);

                    const [server] = await db
                        .update(mcpServers)
                        .set({ ...parsed.data, updatedAt: new Date() })
                        .where(eq(mcpServers.id, id))
                        .returning();
                    if (!server) throw new HttpError(404, 'MCP 服务器不存在');
                    return json(server);
                } catch (e) {
                    return errorResponse(e);
                }
            },
            DELETE: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, 'MCP 服务器 ID');
                    const deleted = await db.delete(mcpServers).where(eq(mcpServers.id, id)).returning({ id: mcpServers.id });
                    if (deleted.length === 0) throw new HttpError(404, 'MCP 服务器不存在');
                    return json({ ok: true });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
