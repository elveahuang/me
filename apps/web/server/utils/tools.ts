import { tool, type ToolSet } from 'ai';
import * as zod from 'zod';
import type { Tool } from '../db/schema';
import { fillAndPinOrigin, fillUrlTemplate, safeOutboundFetch } from './outbound';

/**
 * Tool = 智能体可调用的 AI SDK tool。
 * - builtin_time：内置工具，返回当前时间
 * - http：完全由后台配置的 HTTP 端点（URL / 方法 / 参数 schema 来自 tools.config）
 *
 * 工具名统一为 tool_{id}，便于从模型调用名反查工具行。
 */

export interface HttpToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean';
    description?: string;
    required?: boolean;
}

export interface HttpToolConfig {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    /** 请求体模板，支持 {{paramName}} 占位符 */
    bodyTemplate?: string;
    parameters?: HttpToolParameter[];
}

function zodType(type: string): zod.ZodTypeAny {
    switch (type) {
        case 'number':
            return zod.number();
        case 'boolean':
            return zod.boolean();
        default:
            return zod.string();
    }
}

function buildInputSchema(config: HttpToolConfig): zod.ZodTypeAny {
    const shape: Record<string, zod.ZodTypeAny> = {};
    for (const param of config.parameters ?? []) {
        if (!param.name) continue;
        let field: zod.ZodTypeAny = zodType(param.type).describe(param.description ?? param.name);
        if (!param.required) field = field.optional();
        shape[param.name] = field;
    }
    return zod.object(shape);
}

/** 占位符取值的字符串形式（对象按 JSON 序列化，缺失值按空串） */
function textOf(value: unknown): string {
    if (value === undefined) return '';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value) ?? '';
        } catch {
            return String(value);
        }
    }
    return String(value);
}

/** 落在 JSON 字符串字面量内的替换值：转义后的内容本身，不带引号 */
function jsonStringBody(value: unknown): string {
    return JSON.stringify(textOf(value)).slice(1, -1);
}

/** 落在 JSON 字符串外的替换值：一个完整的 JSON 值 */
function jsonValueText(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value) ?? '';
    } catch {
        return '';
    }
}

/**
 * 用输入值填充 {{param}} 占位符（URL 模板必须走 fillAndPinOrigin，这里只管请求体）。
 *
 * 占位符的值由模型自主拼接，所以 JSON 模板必须按结构替换：原先的 `String(value)` 让
 * `x", "confirmed": true, "z": "` 这样的取值直接往管理员钉死的请求体里注入任意字段，
 * 一个普普通通的引号也会让整段 JSON 失效。
 * - 占位符位于字符串字面量内 → 替换为转义后的内容（不闭合外层引号）；
 * - 位于字符串外 → 替换为完整 JSON 值（字符串补引号，数字/布尔原样）。
 * 非 JSON 模板（表单编码等）没有结构可破坏，保持直替语义不变。
 */
export function fillTemplate(template: string, values: Record<string, unknown>): string {
    if (!/^\s*[[{]/.test(template)) return fillUrlTemplate(template, values);

    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < template.length; i++) {
        const ch = template[i]!;
        if (!escaped && ch === '{' && template[i + 1] === '{') {
            const end = template.indexOf('}}', i + 2);
            const name = end === -1 ? '' : template.slice(i + 2, end);
            if (/^\w+$/.test(name)) {
                out += inString ? jsonStringBody(values[name]) : jsonValueText(values[name]);
                i = end + 1;
                continue;
            }
        }
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            out += ch;
            continue;
        }
        if (ch === '"') inString = true;
        out += ch;
    }
    return out;
}

async function executeHttpTool(config: HttpToolConfig, input: Record<string, unknown>): Promise<string> {
    const method = (config.method ?? 'GET').toUpperCase();
    // 参数由模型自主拼接：先锁定管理员配置的 origin（防参数改写主机），SSRF 校验与出站由 safeOutboundFetch 统一把关
    const url = fillAndPinOrigin(config.url, input);
    const headers: Record<string, string> = {
        accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
        ...config.headers,
    };
    let body: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
        body = config.bodyTemplate ? fillTemplate(config.bodyTemplate, input) : JSON.stringify(input);
        if (!headers['content-type']) headers['content-type'] = 'application/json';
    }

    // 不自动跟随重定向：否则任一通过校验的公网端点都能 302 到内网/云元数据地址（169.254.169.254）。
    // 也不再用裸 fetch：预检与解析之间存在 DNS rebinding 窗口，safeOutboundFetch 在 socket 连接期重新校验 IP。
    const res = await safeOutboundFetch(url, { method, headers, body, timeoutMs: 15_000 });
    if (res.status >= 300 && res.status < 400) {
        return `HTTP ${res.status}: 出于安全策略未跟随重定向${res.location ? `（Location: ${res.location.slice(0, 200)}）` : ''}`;
    }
    if (res.status < 200 || res.status >= 300) return `HTTP ${res.status}: ${res.text}`;
    return res.text || '(空响应)';
}

/**
 * 把管理端配置的工具行转换为 AI SDK 工具集。
 * 单个工具构建失败只跳过该工具，不影响整体对话。
 */
export function buildToolSet(rows: Tool[]): ToolSet {
    const set: Record<string, unknown> = {};
    for (const row of rows) {
        if (!row.enabled) continue;
        try {
            if (row.type === 'builtin_time') {
                set[`tool_${row.id}`] = tool({
                    description: row.description || row.name,
                    inputSchema: zod.object({}),
                    execute: async () => `当前时间（UTC ISO）：${new Date().toISOString()}`,
                });
                continue;
            }

            if (row.type === 'http') {
                const config = (row.config ?? {}) as unknown as HttpToolConfig;
                if (!config.url) continue;
                const configRef = config;
                set[`tool_${row.id}`] = tool({
                    description: row.description || row.name,
                    inputSchema: buildInputSchema(configRef),
                    execute: async (input) => executeHttpTool(configRef, (input ?? {}) as Record<string, unknown>),
                });
            }
        } catch (error) {
            console.error(`[tools] 构建工具失败（id=${row.id} name=${row.name}）:`, error);
        }
    }
    return set as ToolSet;
}
