import { tool, type ToolSet } from 'ai';
import * as zod from 'zod';
import type { Tool } from '../db/schema';
import { assertSafeOutboundUrl } from './outbound';

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

/** 用输入值填充 {{param}} 占位符（URL 与请求体模板共用） */
export function fillTemplate(template: string, values: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
        const value = values[name];
        if (value === undefined) return '';
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
}

async function executeHttpTool(config: HttpToolConfig, input: Record<string, unknown>): Promise<string> {
    const method = (config.method ?? 'GET').toUpperCase();
    const url = fillTemplate(config.url, input);
    // 模型可自主拼接参数，执行前必须做一次出站地址校验（防 SSRF）
    await assertSafeOutboundUrl(url);
    const headers: Record<string, string> = {
        accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
        ...config.headers,
    };
    let body: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
        body = config.bodyTemplate ? fillTemplate(config.bodyTemplate, input) : JSON.stringify(input);
        if (!headers['content-type']) headers['content-type'] = 'application/json';
    }

    // redirect: 'manual'：不自动跟随重定向。否则任一通过校验的公网端点都能 302 到
    // 内网/云元数据地址（169.254.169.254），绕过上面的 assertSafeOutboundUrl（SSRF）。
    const res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location') ?? '';
        return `HTTP ${res.status}: 出于安全策略未跟随重定向${location ? `（Location: ${location.slice(0, 200)}）` : ''}`;
    }
    const text = (await res.text()).slice(0, 4000);
    if (!res.ok) return `HTTP ${res.status}: ${text}`;
    return text || '(空响应)';
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

/** 从工具名反查工具行 id（tool_xxx -> xxx） */
export function toolIdFromName(name: string): string | null {
    const match = /^tool_(.+)$/.exec(name);
    return match ? match[1]! : null;
}
