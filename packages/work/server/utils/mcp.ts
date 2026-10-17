import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import { and, eq, inArray } from 'drizzle-orm';
import { createError } from 'h3';
import { mcpServers } from '../db/schema';
import { db } from './db';
import { stripNull } from './pg-text';

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
 * 一台接受 TCP 却迟迟不回包的 MCP 服务器会把请求挂在「入参校验通过 → 加载能力绑定」这一步，
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
        // 命名空间化，避免多服务器工具重名。塌平规则与查重口径共用 mcpToolNamespace()，
        // 任何一侧单独改正则都会让「保存时判为不冲突、运行时照样撞车」重新出现。
        const namespaced: ToolSet = {};
        const prefix = `mcp_${mcpToolNamespace(server.name)}_`;
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
    const name = typeof raw === 'string' ? stripNull(raw).trim() : '';
    if (!name) throw createError({ statusCode: 400, statusMessage: 'name 必填' });
    if (name.length > MCP_NAME_MAX) throw createError({ statusCode: 400, statusMessage: `name 过长（最多 ${MCP_NAME_MAX} 字符）` });
    return name;
}

/**
 * 名字里非 `\w` 的字符全部塌成 `_`，所以 `DB-Core`、`DB Core` 与 `DB_Core` 落进同一个工具命名空间。
 *
 * 撞掉的到底是什么：两台服务器只要有同名工具（`search` 这类通用名字很常见），SDK 生成的工具 id 就完全相同，
 * 合并工具集时后者覆盖前者；`tools/call` 于是打到另一台 `url` 上，而那台收到的是一个它从没 advertise 过的
 * 名字（参数 schema 还是前一台的），要么回 -32602，要么按自己的逻辑解释一遍。界面看到的是「连上了一台
 * 配好工具的 MCP」，看不出少了一组工具。查重口径必须是这个塌平之后的命名空间，而不是原始字符串。
 */
export function mcpToolNamespace(name: string): string {
    return name.replace(/[^\w]/g, '_');
}

type McpRowRunner = Pick<typeof db, 'select'>;

/**
 * 找出与 `name` 共用工具命名空间的那台服务器（`excludeId` 用于改名时排除自己）。
 *
 * 比对必须放在 JS 里：`\w` 是 ASCII 口径，中点、破折号、CJK 字符都要换成 `_`，PostgreSQL 的
 * `[^[:alnum:]_]` 会把它们全认成字母，两边各算一套就会漏判——而漏判的表现是 200 + 一份少了几件工具的
 * 工具集，没有任何日志。mcp_servers 是个人工作台规模的少量行，为了一个确定性口径整表读两列，
 * 比在 SQL 里复刻正则划算。
 */
export async function findMcpNamespaceConflict(runner: McpRowRunner, name: string, excludeId?: string) {
    const namespace = mcpToolNamespace(name);
    const rows = await runner.select({ id: mcpServers.id, name: mcpServers.name }).from(mcpServers);
    return rows.find((row) => row.id !== excludeId && mcpToolNamespace(row.name) === namespace) ?? null;
}

/** transport 的取值域就是 schema 里注释的那两个值；连接层按它二选一（见 buildMcpTransport 那段）。 */
const MCP_TRANSPORTS = ['http', 'sse'] as const;

/**
 * 未知值直接 400，不静默回退——与 `work-input.ts` 的 `normalizeWorkEnum` 同一立场。
 *
 * 原写法是 `raw === 'sse' ? 'sse' : 'http'`：除了 'sse' 以外的一切都被改写成 'http'。
 * 表单的下拉里选不到错值，所以它平时不响；但手工请求、脚本回填、以后新增的传输类型都会撞上——
 * 请求回 200、界面显示「已保存」，库里存的却是用户根本没提交过的值，
 * 之后连接失败只表现为「这台服务器连不上」，没人会怀疑是保存环节把值换掉了。
 * 未提供（undefined/null/空串）仍按列默认值 'http' 处理，那是「没选」而不是「选错了」。
 */
export function normalizeMcpTransport(raw: unknown): string {
    if (raw === undefined || raw === null) return 'http';
    if (typeof raw !== 'string') throw createError({ statusCode: 400, statusMessage: `transport 只能是 ${MCP_TRANSPORTS.join(' / ')}` });
    const value = stripNull(raw).trim();
    if (!value) return 'http';
    if (!(MCP_TRANSPORTS as readonly string[]).includes(value)) {
        throw createError({ statusCode: 400, statusMessage: `transport 只能是 ${MCP_TRANSPORTS.join(' / ')}` });
    }
    return value;
}

/** 正常 MCP 配置只有个位数 header；超大数量只会把每次连接的请求头撑到对端拒绝（对齐 HTTP 工具的上限） */
const MCP_HEADER_MAX = 32;
const MCP_HEADER_KEY_MAX = 200;
const MCP_HEADER_VALUE_MAX = 4000;

export function normalizeMcpHeaders(raw: unknown): Record<string, string> {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400, statusMessage: 'headers 必须为对象' });
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > MCP_HEADER_MAX) throw createError({ statusCode: 400, statusMessage: `headers 过多（最多 ${MCP_HEADER_MAX} 项）` });
    const headers: Record<string, string> = {};
    for (const [key, value] of entries) {
        // 列类型是 Record<string,string>，而连接层会把这些值直接塞进请求头：
        // 数字/对象虽然能进 jsonb，运行时要不出错要么被静默 stringify 成 "[object Object]"
        if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: `header「${key}」的值必须为字符串` });
        // 键名里带空格/冒号/换行会在运行期由 fetch 拒绝：该服务器此后每次连接都失败，而保存时毫无提示
        if (!/^[a-zA-Z0-9!#$%&'*+\-.^_|~]+$/.test(key)) throw createError({ statusCode: 400, statusMessage: `header 名「${key}」含非法字符` });
        if (key.length > MCP_HEADER_KEY_MAX) throw createError({ statusCode: 400, statusMessage: `header 名过长（最多 ${MCP_HEADER_KEY_MAX} 字符）` });
        if (value.length > MCP_HEADER_VALUE_MAX) throw createError({ statusCode: 400, statusMessage: `header「${key}」的值过长（最多 ${MCP_HEADER_VALUE_MAX} 字符）` });
        // headers 整段落 jsonb，键或值里的 NUL 会让 PostgreSQL 判整段 JSON 非法
        headers[stripNull(key)] = stripNull(value);
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
