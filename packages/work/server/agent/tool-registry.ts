import type { Tool, ToolSet } from 'ai';

/**
 * P1-5：轻量 ToolRegistry / dispatch 层。
 *
 * 不重写工具装配，只在把 ToolSet 交给模型之前统一包一层：
 * - 每次执行都有超时（与调用方已有的 AbortSignal 合并）；
 * - 输出超过上限时截断并带 `truncated` 标记；
 * - 错误映射成稳定 code（TOOL_TIMEOUT / TOOL_ABORTED / TOOL_FAILED）；
 * - 进程内计数（调用/失败/超时/截断/总耗时），供 `/api/tools/metrics` 观察。
 *
 * 输入校验仍由 AI SDK 依据工具的 `inputSchema` 完成；审批仍由 `wrapToolsWithApproval`
 * 在外层执行。注册表只负责「所有工具都经过同一组护栏」，不改变工具语义。
 */

export const TOOL_TIMEOUT_MS = 60_000;
export const TOOL_OUTPUT_MAX_BYTES = 20 * 1024;

const WRAPPED = Symbol.for('work.tool-registry.wrapped');

export interface ToolMetric {
    calls: number;
    failures: number;
    timeouts: number;
    truncated: number;
    totalMs: number;
}

const metrics = new Map<string, ToolMetric>();

function metricFor(name: string): ToolMetric {
    let value = metrics.get(name);
    if (!value) {
        value = { calls: 0, failures: 0, timeouts: 0, truncated: 0, totalMs: 0 };
        metrics.set(name, value);
    }
    return value;
}

export function getToolMetrics(): Record<string, ToolMetric> {
    return Object.fromEntries([...metrics.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, { ...value }]));
}

export function resetToolMetrics(): void {
    metrics.clear();
}

function toolError(code: string, message: string): Error {
    return Object.assign(new Error(`[${code}] ${message}`), { code });
}

function clipOutput(value: unknown, maxBytes: number): { value: unknown; truncated: boolean } {
    let text: string;
    try {
        text = JSON.stringify(value) ?? '';
    } catch {
        return { value, truncated: false };
    }
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { value, truncated: false };
    return {
        value: {
            truncated: true,
            note: `工具输出超过 ${maxBytes} 字节，已截断；完整内容请缩小查询范围`,
            preview: text.slice(0, maxBytes),
        },
        truncated: true,
    };
}

/** 包装单个工具；已经包过的直接返回，避免 MCP 合并后再包一层。 */
export function wrapToolWithRegistry(name: string, tool: Tool, registryOptions: { timeoutMs?: number } = {}): Tool {
    const timeoutMs = registryOptions.timeoutMs ?? TOOL_TIMEOUT_MS;
    if ((tool as unknown as Record<symbol, boolean>)[WRAPPED]) return tool;
    const originalExecute = tool.execute;
    if (typeof originalExecute !== 'function') {
        Object.defineProperty(tool, WRAPPED, { value: true });
        return tool;
    }
    const wrapped: Tool = {
        ...tool,
        execute: async (input, options) => {
            const metric = metricFor(name);
            const started = Date.now();
            metric.calls += 1;
            let timedOut = false;
            const controller = new AbortController();
            const timeout = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
            const signal = options?.abortSignal ? AbortSignal.any([options.abortSignal, controller.signal]) : controller.signal;
            try {
                const result = await originalExecute(input, { ...options, abortSignal: signal });
                // 工具可能忽略 abortSignal 继续跑完；超时/中止后不能把迟到结果当成成功。
                if (timedOut) throw toolError('TOOL_TIMEOUT', `工具 ${name} 执行超过 ${timeoutMs / 1000} 秒`);
                if (signal.aborted) throw toolError('TOOL_ABORTED', `工具 ${name} 已中止`);
                const clipped = clipOutput(result, TOOL_OUTPUT_MAX_BYTES);
                if (clipped.truncated) metric.truncated += 1;
                return clipped.value as typeof result;
            } catch (error) {
                metric.failures += 1;
                if (timedOut) {
                    metric.timeouts += 1;
                    throw toolError('TOOL_TIMEOUT', `工具 ${name} 执行超过 ${timeoutMs / 1000} 秒`);
                }
                if (signal.aborted) throw toolError('TOOL_ABORTED', `工具 ${name} 已中止`);
                if (error instanceof Error) throw toolError('TOOL_FAILED', error.message);
                throw toolError('TOOL_FAILED', String(error));
            } finally {
                clearTimeout(timeout);
                metric.totalMs += Date.now() - started;
            }
        },
    } as Tool;
    Object.defineProperty(wrapped, WRAPPED, { value: true });
    return wrapped;
}

export function applyToolRegistry(toolSet: ToolSet): ToolSet {
    return Object.fromEntries(Object.entries(toolSet).map(([name, tool]) => [name, wrapToolWithRegistry(name, tool)]));
}
