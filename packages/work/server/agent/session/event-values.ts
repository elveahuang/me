import { stripNullDeep } from '../../utils/pg-text';

/** 单条事件里工具入参/输出的字符上限；超出的只留 preview，避免撑爆 jsonb。 */
export const EVENT_VALUE_MAX_CHARS = 20_000;

/**
 * 把工具入参/输出裁成可安全落 jsonb 的形状。
 * 超限只留 preview；序列化失败（循环引用）退化成字符串。
 */
export function clipEventValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    try {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        if (typeof text !== 'string') return value;
        if (text.length <= EVENT_VALUE_MAX_CHARS) return stripNullDeep(value);
        return { truncated: true, chars: text.length, preview: text.slice(0, EVENT_VALUE_MAX_CHARS) };
    } catch {
        return String(value).slice(0, EVENT_VALUE_MAX_CHARS);
    }
}

/** 工具错误只留可读摘要，不把整段堆栈/驱动细节写进事件。 */
export function toolErrorSummary(error: unknown): unknown {
    if (error instanceof Error) return { name: error.name, message: error.message };
    return clipEventValue(error);
}
