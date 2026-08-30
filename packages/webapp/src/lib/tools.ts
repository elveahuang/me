import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import type { tools } from '@/db/schema';

type ToolRow = typeof tools.$inferSelect;

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

function zodType(type: string) {
    switch (type) {
        case 'number':
            return z.number();
        case 'boolean':
            return z.boolean();
        default:
            return z.string();
    }
}

function buildInputSchema(config: HttpToolConfig) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const param of config.parameters ?? []) {
        if (!param.name) continue;
        let field: z.ZodTypeAny = zodType(param.type).describe(param.description ?? param.name);
        if (!param.required) field = field.optional();
        shape[param.name] = field;
    }
    return z.object(shape);
}

function fillTemplate(template: string, values: Record<string, unknown>) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
        const value = values[name];
        return value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
}

async function executeHttpTool(config: HttpToolConfig, input: Record<string, unknown>) {
    const method = (config.method ?? 'GET').toUpperCase();
    const url = fillTemplate(config.url, input);
    const headers: Record<string, string> = {
        accept: 'application/json, text/plain;q=0.8, */*;q=0.5',
        ...(config.headers ?? {}),
    };
    let body: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
        body = config.bodyTemplate ? fillTemplate(config.bodyTemplate, input) : JSON.stringify(input);
        if (!headers['content-type']) headers['content-type'] = 'application/json';
    }

    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15_000) });
    const text = (await res.text()).slice(0, 4000);
    if (!res.ok) {
        return `HTTP ${res.status}: ${text}`;
    }
    return text || '(空响应)';
}

/**
 * 把管理端配置的工具行转换为 AI SDK 工具集。
 * 只处理 enabled 且结构合法的工具，单个工具构建失败不影响整体。
 */
export function buildToolSet(rows: ToolRow[]): ToolSet {
    const set: ToolSet = {};
    for (const row of rows) {
        try {
            if (row.type === 'builtin_time') {
                set[`tool_${row.id}`] = tool({
                    description: row.description || row.name,
                    inputSchema: z.object({}).loose(),
                    execute: async () => `当前时间（UTC ISO）：${new Date().toISOString()}`,
                });
                continue;
            }

            if (row.type === 'http') {
                const config = (row.config ?? {}) as HttpToolConfig;
                if (!config.url) continue;
                const configRef = config;
                set[`tool_${row.id}`] = tool({
                    description: row.description || row.name,
                    inputSchema: buildInputSchema(configRef),
                    execute: async (input) => executeHttpTool(configRef, input as Record<string, unknown>),
                });
            }
        } catch (e) {
            console.error(`[tools] 构建工具失败（id=${row.id} name=${row.name}）:`, e);
        }
    }
    return set;
}

/** 把工具名映射回工具行（tool_N -> row），用于日志与错误呈现 */
export function toolIdFromName(name: string) {
    const match = /^tool_(\d+)$/.exec(name);
    return match ? Number(match[1]) : null;
}
