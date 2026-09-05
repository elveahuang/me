import { db } from '@/db';
import { errorResponse, HttpError, json, parseId, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { listMcpTools } from '@/lib/mcp';
import { mcpServers } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';

type RouteParams = { request: Request; params: { id: string } };

/** 测试 MCP 服务器连接：返回其提供的工具列表 */
export const Route = createFileRoute('/api/admin/mcp/$id/test')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            POST: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, 'MCP 服务器 ID');
                    const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
                    if (!server) throw new HttpError(404, 'MCP 服务器不存在');

                    try {
                        const tools = await listMcpTools(server);
                        return json({ ok: true, toolCount: tools.length, tools });
                    } catch (e) {
                        return json({ ok: false, error: e instanceof Error ? e.message : '连接失败' });
                    }
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
