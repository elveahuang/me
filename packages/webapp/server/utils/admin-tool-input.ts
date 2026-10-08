import { createError } from 'h3';

/**
 * 管理端 tools 资源的入参归一。
 * 非字符串塞 text 列、非布尔塞 boolean 列都会被 PostgreSQL 拒成 500 并把 SQL 细节透出响应体，
 * 所以在写入前统一校验/截断（name 规则对齐 skills：trim 后非空、限长 100）。
 */
export function normalizeToolName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) throw createError({ statusCode: 400, statusMessage: 'name 必填' });
    if (name.length > 100) throw createError({ statusCode: 400, statusMessage: 'name 过长（最多 100 字符）' });
    return name;
}

export function normalizeToolDescription(raw: unknown): string {
    return typeof raw === 'string' ? raw.slice(0, 500) : '';
}

const AVAILABLE_TOOL_TYPES = ['builtin_time', 'http'];

/**
 * 工具类型：未知值必须报错，不能静默回退。
 * POST 过去把任何非法 type 当成 builtin_time，于是「建一个 http 工具」的请求会因为
 * 前端一次字段改名而落成一条 builtin_time 行，config 还留在表里看着像配好了；PATCH 早已 400。
 */
export function normalizeToolType(raw: unknown): string {
    if (typeof raw !== 'string' || !AVAILABLE_TOOL_TYPES.includes(raw)) {
        throw createError({ statusCode: 400, statusMessage: `不支持的工具类型，仅允许 ${AVAILABLE_TOOL_TYPES.join(' / ')}` });
    }
    return raw;
}

const TOOL_URL_MAX = 2000;
const TOOL_BODY_TEMPLATE_MAX = 20_000;
/** 单个工具的请求头条数上限：正常配置只有个位数，超大数量只会把请求头撑到对端拒绝 */
const TOOL_HEADER_MAX = 32;
/** 执行期把 method 直接交给 http.request，非标准动词落库等于把该工具变成每次调用都抛错的死配置 */
const TOOL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

/**
 * config.url 是带 `{{param}}` 占位的模板，填充前就能被 URL 解析（占位落在 path/query/host 段均可），
 * 因此这里校验协议与形态。刻意保留原串不做 trailing-slash 归一：`/v1/` 与 `/v1` 是两个端点，
 * 且工具不跟随重定向，去掉末尾斜杠会把已配置的服务打挂。
 */
function assertToolUrl(raw: unknown): void {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) throw createError({ statusCode: 400, statusMessage: 'config.url 不能为空' });
    if (value.length > TOOL_URL_MAX) throw createError({ statusCode: 400, statusMessage: `config.url 过长（最多 ${TOOL_URL_MAX} 字符）` });
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'config.url 不是合法 URL' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw createError({ statusCode: 400, statusMessage: 'config.url 仅允许 http/https 协议' });
    }
}

function assertToolMethod(raw: unknown): void {
    const method = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (!TOOL_METHODS.includes(method)) {
        throw createError({ statusCode: 400, statusMessage: `config.method 仅支持 ${TOOL_METHODS.join(' / ')}` });
    }
}

/**
 * headers 会被展开进请求头：值必须是字符串（对齐 MCP 的 normalizeMcpHeaders）。
 * 数字/对象虽然能进 jsonb，运行时却要嘛被 stringify 成 '[object Object]' 要么让 fetch 直接抛错，
 * 而这两种都只发生在「模型调用该工具」时，管理员看不到任何线索。
 */
function normalizeToolHeaders(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw createError({ statusCode: 400, statusMessage: 'config.headers 必须为对象' });
    }
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > TOOL_HEADER_MAX) throw createError({ statusCode: 400, statusMessage: `config.headers 过多（最多 ${TOOL_HEADER_MAX} 项）` });
    for (const [key, value] of entries) {
        if (!key.trim()) throw createError({ statusCode: 400, statusMessage: 'config.headers 的键不能为空' });
        // RFC 7230 token：含 CR/LF/空格的键名在运行期由 Node 拒绝，等于把工具配成死配置
        if (!/^[a-zA-Z0-9!#$%&'*+\-.^_|~]+$/.test(key)) throw createError({ statusCode: 400, statusMessage: `header 名「${key}」含非法字符` });
        if (typeof value !== 'string') throw createError({ statusCode: 400, statusMessage: `header「${key}」的值必须为字符串` });
    }
}

export function normalizeToolConfig(raw: unknown): Record<string, unknown> {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400, statusMessage: 'config 必须为对象' });
    const config = raw as Record<string, unknown>;
    // 执行期对 parameters 做 for...of、对 headers 做展开：存下非数组/非对象会让该工具每轮对话都抛错
    if (config.parameters !== undefined && !Array.isArray(config.parameters)) {
        throw createError({ statusCode: 400, statusMessage: 'config.parameters 必须为数组' });
    }
    if (config.headers !== undefined) normalizeToolHeaders(config.headers);
    if (config.url !== undefined) assertToolUrl(config.url);
    if (config.method !== undefined) assertToolMethod(config.method);
    if (config.bodyTemplate !== undefined && typeof config.bodyTemplate !== 'string') {
        throw createError({ statusCode: 400, statusMessage: 'config.bodyTemplate 必须为字符串' });
    }
    if (typeof config.bodyTemplate === 'string' && config.bodyTemplate.length > TOOL_BODY_TEMPLATE_MAX) {
        throw createError({ statusCode: 400, statusMessage: `config.bodyTemplate 过长（最多 ${TOOL_BODY_TEMPLATE_MAX} 字符）` });
    }
    return config;
}
