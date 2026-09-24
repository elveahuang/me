import { eq } from 'drizzle-orm';
import { mcpServers } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { requireAdmin } from '../../../../utils/guard';
import { closeMcpConnections, connectMcpServer, MCP_TOOL_LIST_BUDGET_MS } from '../../../../utils/mcp';

/** 连接 MCP Server 并列出其工具（含工具描述与参数 schema）。 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
    if (!server) {
        throw createError({ statusCode: 404, statusMessage: 'MCP Server 不存在' });
    }

    let connection;
    try {
        connection = await connectMcpServer(server);
    } catch (error) {
        return { ok: false, message: `连接失败：${error instanceof Error ? error.message : String(error)}`, tools: [] };
    }

    try {
        /**
         * 这里必须自带预算。`connectMcpServer` 的 15 秒预算只覆盖「握手 + 它自己那次 tools() 发现」，
         * 而本 handler 为了拿原始名称/描述/inputSchema 又发了一次 `tools/list`，原本没有任何超时：
         * 一台握手正常、却对 `tools/list` 永不回包的服务器会把这条管理端请求挂到 undici 的 5 分钟
         * 兜底（若对方还在持续 trickle 字节，连这个兜底都不会触发）。更糟的是 `finally` 要等这次
         * await 结算才跑得到，那条 MCP 连接（sse 传输下还是一直挂着的长连接）在期间不会被关，
         * 管理员多点几次就攒出几条泄漏连接。SDK 的 RequestOptions.timeout 会同时
         * 中止在途请求、摘掉 responseHandler 并清掉定时器，错误也就变成可读的一句。
         */
        let listed: Awaited<ReturnType<typeof connection.client.listTools>>;
        try {
            listed = await connection.client.listTools({ options: { timeout: MCP_TOOL_LIST_BUDGET_MS } });
        } catch (error) {
            return {
                ok: false,
                message: `拉取工具列表失败：${error instanceof Error ? error.message : String(error)}`,
                tools: [],
            };
        }
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
