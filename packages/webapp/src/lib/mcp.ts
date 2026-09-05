import type { mcpServers } from '@/db/schema';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolSet } from 'ai';
import { dynamicTool, jsonSchema } from 'ai';

type McpServerRow = typeof mcpServers.$inferSelect;

const CONNECT_TIMEOUT_MS = 10_000;
const TOOL_CALL_TIMEOUT_MS = 30_000;
const MAX_TEXT_RESULT = 4000;

/** 连接到一个 MCP 服务器 */
export async function connectMcpServer(server: McpServerRow): Promise<Client> {
    const client = new Client({ name: 'me-agent-platform', version: '1.0.0' });

    if (server.transport === 'stdio') {
        if (!server.command) throw new Error('stdio 传输缺少 command');
        // 子进程至少需要 PATH/HOME 才能定位命令；其余变量由服务器配置提供
        const extraEnv = server.env && !Array.isArray(server.env) ? (server.env as Record<string, string>) : {};
        const transport = new StdioClientTransport({
            command: server.command,
            args: Array.isArray(server.args) ? (server.args as string[]) : [],
            env: {
                PATH: process.env.PATH ?? '',
                HOME: process.env.HOME ?? '',
                ...extraEnv,
            },
        });
        await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS, resetTimeoutOnProgress: false });
        return client;
    }

    if (!server.url) throw new Error(`${server.transport} 传输缺少 url`);
    const transport = server.transport === 'sse' ? new SSEClientTransport(new URL(server.url)) : new StreamableHTTPClientTransport(new URL(server.url));
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS, resetTimeoutOnProgress: false });
    return client;
}

export interface McpToolInfo {
    name: string;
    description: string;
    inputSchema: unknown;
}

/** 列出某个 MCP 服务器提供的工具（管理端测试连接用） */
export async function listMcpTools(server: McpServerRow): Promise<McpToolInfo[]> {
    const client = await connectMcpServer(server);
    try {
        const { tools } = await client.listTools({}, { timeout: TOOL_CALL_TIMEOUT_MS });
        return (tools ?? []).map((t) => ({
            name: t.name,
            description: t.description ?? '',
            inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
        }));
    } finally {
        await client.close().catch(() => {});
    }
}

/** MCP 工具的执行结果转为文本 */
async function callMcpTool(client: Client, toolName: string, args: unknown): Promise<string> {
    const result = (await client.callTool({ name: toolName, arguments: (args ?? {}) as Record<string, unknown> }, undefined, {
        timeout: TOOL_CALL_TIMEOUT_MS,
    })) as { content?: { type: string; text?: string }[]; isError?: boolean };

    const text = (result.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')
        .trim();
    const prefix = result.isError ? '[MCP 工具返回错误] ' : '';
    return prefix + (text || '(空结果)').slice(0, MAX_TEXT_RESULT);
}

/**
 * 把所有已挂载且启用的 MCP 服务器的工具合并进 AI SDK 工具集。
 * 每个工具名加 `mcp{serverId}_` 前缀避免跨服务器冲突。
 * 返回工具集、提示词摘要与清理函数（聊天结束后关闭全部连接）。
 */
export async function buildMcpToolSets(servers: McpServerRow[]): Promise<{
    toolSet: ToolSet;
    summary: string[];
    dispose: () => Promise<void>;
}> {
    const toolSet: ToolSet = {};
    const summary: string[] = [];
    const clients: Client[] = [];

    const dispose = async () => {
        for (const client of clients) {
            await client.close().catch(() => {});
        }
    };

    for (const server of servers) {
        let client: Client;
        try {
            client = await connectMcpServer(server);
            clients.push(client);
        } catch (e) {
            console.error(`[mcp] 连接服务器失败（id=${server.id} name=${server.name}）:`, e);
            continue;
        }

        let tools: McpToolInfo[];
        try {
            const listed = await client.listTools({}, { timeout: TOOL_CALL_TIMEOUT_MS });
            tools = (listed.tools ?? []).map((t) => ({
                name: t.name,
                description: t.description ?? '',
                inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
            }));
        } catch (e) {
            console.error(`[mcp] 列出工具失败（id=${server.id}）:`, e);
            continue;
        }

        for (const tool of tools) {
            const schema = tool.inputSchema as Parameters<typeof jsonSchema>[0];
            const toolName = tool.name;
            const fullKey = `mcp${server.id}_${toolName}`;
            toolSet[fullKey] = dynamicTool({
                description: `[MCP:${server.name}] ${tool.description || toolName}`,
                inputSchema: jsonSchema(schema),
                execute: async (args: unknown) => callMcpTool(client, toolName, args),
            });
            summary.push(`- ${fullKey}（MCP 工具，服务器：${server.name}）：${tool.description || toolName}`);
        }
    }

    return { toolSet, summary, dispose };
}
