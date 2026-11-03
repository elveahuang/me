import type { ModelMessage } from 'ai';

/**
 * 粗略 token 计量（P1-3 的第一块）。
 *
 * 不引入 tokenizer：work 支持任意 OpenAI 兼容端点，各家 tokenizer 不同；4 chars/token
 * 对中英文混合是够用的保守近似，只用于「压力提示/压缩触发」，不用于计费。
 * 真正精确的 usage 仍以供应商返回的 `LanguageModelUsage` 为准（已写进 run/end）。
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
}

function contentToText(message: ModelMessage): string {
    const content = message.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((part) => {
            if (!part || typeof part !== 'object') return '';
            const record = part as Record<string, unknown>;
            if (record.type === 'text' && typeof record.text === 'string') return record.text;
            if (record.type === 'tool-call') return `${String(record.toolName ?? 'tool')} ${JSON.stringify(record.input ?? {})}`;
            if (record.type === 'tool-result') return JSON.stringify(record.output ?? {});
            if (record.type === 'image' || record.type === 'file') return '[binary]';
            return '';
        })
        .join('\n');
}

/** 估算整个消息窗口的输入 token；每条消息另有约 4 token 的角色/分隔开销。 */
export function estimateMessageTokens(messages: readonly ModelMessage[]): number {
    return messages.reduce((total, message) => total + estimateTokens(contentToText(message)) + 4, 0);
}

export interface SurfaceMeasurement {
    tokens: number;
    budget: number;
    /** 0–1+；> 0.7 表示接近压缩阈值 */
    pressure: number;
}

/**
 * 上下文预算：默认按 128K 窗口的 70% 留给历史。
 * 这是「消息窗口」口径，不含系统提示与工具 schema；两者由调用方另行扣减。
 */
export function measureSurface(messages: readonly ModelMessage[], contextWindow = 128_000, budgetRatio = 0.7): SurfaceMeasurement {
    const tokens = estimateMessageTokens(messages);
    const budget = Math.max(1, Math.floor(contextWindow * budgetRatio));
    return { tokens, budget, pressure: tokens / budget };
}
