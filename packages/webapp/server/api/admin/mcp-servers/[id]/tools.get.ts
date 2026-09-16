import { eq } from 'drizzle-orm';
import { mcpServers } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { requireAdmin } from '../../../../utils/guard';
import { closeMcpConnections, connectMcpServer } from '../../../../utils/mcp';

/** 连接 MCP Server 并列出其工具（含工具描述与参数 schema）。 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
    if (!server) {
        throw createError({ statusCode: 404, statusMessage: 'MCP Server not found' });
    }

    let connection;
    try {
        connection = await connectMcpServer(server);
    } catch (error) {
        return { ok: false, message: `连接失败：${error instanceof Error ? error.message : String(error)}`, tools: [] };
    }

    try {
        const listed = await connection.client.listTools();
        return {
            ok: true,
            serverInfo: connection.client.serverInfo,
            tools: (listed.tools ?? []).map((t: { name: string; description?: string; inputSchema?: unknown }) => ({
                name: `mcp_${server.name.replace(/[^\w]/g, '_')}_${t.name}`,
                originalName: t.name,
                description: t.description ?? '',
                inputSchema: t.inputSchema ?? null,
            })),
        };
    } finally {
        await closeMcpConnections([connection]);
    }
});
