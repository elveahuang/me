import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import { eq } from 'drizzle-orm';
import { mcpServers } from '../db/schema';
import { db } from './db';

/**
 * MCP 工具接入：把后台配置的 MCP Server（http/sse）连接起来，
 * 将其工具命名空间化（mcp_<server>_<tool>）后并入智能体的工具集。
 * 调用方必须在对话结束后调用 close() 释放连接。
 */

export interface McpConnection {
    serverId: string;
    serverName: string;
    client: MCPClient;
    tools: ToolSet;
}

export async function connectMcpServer(server: {
    id: string;
    name: string;
    url: string;
    transport: string;
    headers: Record<string, string>;
}): Promise<McpConnection> {
    const client = await createMCPClient({
        transport: {
            type: server.transport === 'sse' ? 'sse' : 'http',
            url: server.url,
            headers: server.headers,
        } as never,
        // 兼容标准 initialize 握手的服务端
        protocolVersionDiscovery: false,
        onUncaughtError: (error) => console.error(`[mcp:${server.name}]`, error),
    });
    const toolSet = await client.tools();
    // 命名空间化，避免多服务器工具重名
    const namespaced: ToolSet = {};
    const prefix = `mcp_${server.name.replace(/[^\w]/g, '_')}_`;
    for (const [name, t] of Object.entries(toolSet)) {
        namespaced[prefix + name] = t as never;
    }
    return { serverId: server.id, serverName: server.name, client, tools: namespaced };
}

export async function connectEnabledMcpServers(serverIds: string[]) {
    const connections: McpConnection[] = [];
    if (!serverIds.length) return connections;

    const rows = (await db.select().from(mcpServers).where(eq(mcpServers.enabled, true))).filter((s) => serverIds.includes(s.id));
    for (const row of rows) {
        try {
            connections.push(await connectMcpServer(row));
        } catch (error) {
            console.error(`[mcp:${row.name}] 连接失败，跳过该服务器的工具:`, error);
        }
    }
    return connections;
}

export function mergeMcpTools(base: ToolSet, connections: McpConnection[]): ToolSet {
    const merged: ToolSet = { ...base };
    for (const c of connections) {
        Object.assign(merged, c.tools);
    }
    return merged;
}

export async function closeMcpConnections(connections: McpConnection[]) {
    for (const c of connections) {
        try {
            await c.client.close();
        } catch (error) {
            console.error(`[mcp:${c.serverName}] 关闭连接失败:`, error);
        }
    }
}

/** 敏感 header 的掩码值（MCP 配置里常放 API Key，列表接口不应明文回显） */
export const MASKED_HEADER_VALUE = '****';

export function maskHeaders(headers: Record<string, string> | null | undefined): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
        masked[key] = value ? MASKED_HEADER_VALUE : '';
    }
    return masked;
}

/**
 * 合并前端回传的 headers：值为掩码时保留旧值（用户没改），空值表示删除该 header。
 * 这样管理端"编辑 → 保存"不会把真实密钥覆盖成 `****`。
 */
export function mergeHeaders(
    existing: Record<string, string> | null | undefined,
    incoming: Record<string, unknown> | null | undefined,
): Record<string, string> {
    const merged: Record<string, string> = { ...(existing ?? {}) };
    for (const [key, rawValue] of Object.entries(incoming ?? {})) {
        if (typeof rawValue !== 'string') continue;
        if (rawValue === MASKED_HEADER_VALUE) continue;
        if (rawValue === '') {
            delete merged[key];
            continue;
        }
        merged[key] = rawValue;
    }
    return merged;
}
