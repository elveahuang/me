import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import { and, eq, inArray } from 'drizzle-orm';
import { createError } from 'h3';
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

/** 建连总预算（握手 + 工具发现），与 HTTP 工具的 15 秒超时同档 */
const MCP_CONNECT_BUDGET_MS = 15_000;

/**
 * 单独一次 `tools/list` 的预算。管理端「查看工具」为了拿原始名称/描述/schema 会在建连之后
 * 再发一次发现请求，那次调用同样不受 `withinBudget` 覆盖，必须自带超时。
 */
export const MCP_TOOL_LIST_BUDGET_MS = 15_000;

/**
 * @ai-sdk/mcp 只有显式传 initializationOptions 才会给握手设超时，`tools()` 更是完全没有预算：
 * 一台接受 TCP 却迟迟不回包的 MCP 服务器会把请求挂在「已扣额度 → 加载能力绑定」这一步，
 * 最长要等到 undici 的默认上限（实测约 300 秒：不回响应头在 +304.7s 抛 HeadersTimeoutError）才会自己解开。
 * signal 打断 SDK 认识的请求，竞速兜住在途的 tools/list。
 */
async function withinBudget<T>(work: Promise<T>, deadline: AbortSignal, serverName: string): Promise<T> {
    // 竞速落败后 SDK 内部那条 promise 仍可能 reject，先接住，免得变成 unhandledRejection 打挂进程
    work.catch(() => undefined);
    const fail = () => new Error(`MCP 建连在 ${MCP_CONNECT_BUDGET_MS}ms 内未完成（${serverName}）`);
    if (deadline.aborted) throw fail();
    let onAbort: () => void;
    const guard = new Promise<never>((_, reject) => {
        onAbort = () => reject(fail());
        deadline.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([work, guard]);
    } finally {
        deadline.removeEventListener('abort', onAbort!);
    }
}

export async function connectMcpServer(server: {
    id: string;
    name: string;
    url: string;
    transport: string;
    headers: Record<string, string>;
}): Promise<McpConnection> {
    const deadline = AbortSignal.timeout(MCP_CONNECT_BUDGET_MS);
    const client = await createMCPClient({
        transport: {
            type: server.transport === 'sse' ? 'sse' : 'http',
            url: server.url,
            headers: server.headers,
        } as never,
        // 兼容标准 initialize 握手的服务端
        protocolVersionDiscovery: false,
        initializationOptions: { signal: deadline },
        onUncaughtError: (error) => console.error(`[mcp:${server.name}]`, error),
    });
    try {
        const toolSet = await withinBudget(client.tools(), deadline, server.name);
        // 命名空间化，避免多服务器工具重名
        const namespaced: ToolSet = {};
        const prefix = `mcp_${server.name.replace(/[^\w]/g, '_')}_`;
        for (const [name, t] of Object.entries(toolSet)) {
            namespaced[prefix + name] = t as never;
        }
        return { serverId: server.id, serverName: server.name, client, tools: namespaced };
    } catch (error) {
        // 客户端已经握手成功，tools/资源发现才失败；不关掉就把这条连接永久漏在进程里，
        // 而上层（connectEnabledMcpServers）只会收到 rejected Promise，拿不到 client 句柄。
        await client.close().catch((closeError) => console.error(`[mcp:${server.name}] 半成品连接关闭失败:`, closeError));
        throw error;
    }
}

export async function connectEnabledMcpServers(serverIds: string[]) {
    const connections: McpConnection[] = [];
    if (!serverIds.length) return connections;

    // 直接在 SQL 里用 inArray 取「已启用且被本智能体绑定」的服务器，
    // 不要全表拉取启用项后在 JS 里 filter——MCP 服务器数量会随运营增长。
    const rows = await db
        .select()
        .from(mcpServers)
        .where(and(inArray(mcpServers.id, [...new Set(serverIds)]), eq(mcpServers.enabled, true)));
    // 并发建连：每个服务器的失败已被单独捕获，互不影响，串行会把连接延迟线性累加到首 token 前。
    const settled = await Promise.allSettled(rows.map((row) => connectMcpServer(row)));
    for (const [i, row] of rows.entries()) {
        const result = settled[i]!;
        if (result.status === 'fulfilled') connections.push(result.value);
        else console.error(`[mcp:${row.name}] 连接失败，跳过该服务器的工具:`, result.reason);
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
const MASKED_HEADER_VALUE = '****';

/**
 * 管理端 mcp-servers 的入参归一（POST 与 PATCH 共用一份）。
 *
 * name 会当作运行时工具前缀（mcp_<name>_<tool>）；headers 落 jsonb 列，数组/字符串都能「合法」写入，
 * 之后被连接层当对象展开就会让每个用到该服务器的会话抛错；enabled 是 boolean 列，非布尔直写会被
 * PostgreSQL 拒成 500 并把 SQL 细节透出响应体。
 */
const MCP_NAME_MAX = 100;

export function normalizeMcpName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) throw createError({ statusCode: 400, statusMessage: 'name 必填' });
    if (name.length > MCP_NAME_MAX) throw createError({ statusCode: 400, statusMessage: `name 过长（最多 ${MCP_NAME_MAX} 字符）` });
    return name;
}

export function normalizeMcpTransport(raw: unknown): string {
    return raw === 'sse' ? 'sse' : 'http';
}

export function normalizeMcpHeaders(raw: unknown): Record<string, string> {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400, statusMessage: 'headers 必须为对象' });
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        // 列类型是 Record<string,string>，而连接层会把这些值直接塞进请求头：
        // 数字/对象虽然能进 jsonb，运行时要不出错要么被静默 stringify 成 "[object Object]"
        if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: `header「${key}」的值必须为字符串` });
        headers[key] = value;
    }
    return headers;
}

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
