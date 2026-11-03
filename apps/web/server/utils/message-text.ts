/**
 * 消息 parts → 纯文本，用于 `messages.content_text` 的检索列。
 * 只取 text part；附件、工具调用等结构不参与全文匹配，避免把 JSON 键名也搜出来。
 */
export function partsToPlainText(parts: unknown): string {
    if (!Array.isArray(parts)) return '';
    return parts
        .map((part) => {
            if (!part || typeof part !== 'object') return '';
            const record = part as { type?: unknown; text?: unknown };
            return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
        })
        .filter(Boolean)
        .join('\n')
        .replace(/\u0000/g, '')
        .slice(0, 200_000);
}
