/**
 * 聊天错误的可操作提示（P3-2）。
 *
 * 错误对象可能是 h3 的 `{ data: { code } }`、AI SDK 的 `Error`，也可能只是一个字符串；
 * 这里只做「稳定错误码 → 下一步该做什么」的映射，不改写原始错误文案。
 * 文案 key 由调用方 `t()`，纯函数便于冒烟测试。
 */

export type ChatErrorHintKey =
    | 'chat.errorHintTimeout'
    | 'chat.errorHintAborted'
    | 'chat.errorHintDenied'
    | 'chat.errorHintStaleFile'
    | 'chat.errorHintRateLimited'
    | 'chat.errorHintTooLarge'
    | 'chat.errorHintUpstream'
    | 'chat.errorHintFileRoots'
    | 'chat.errorHintForbidden';

function collect(value: unknown, depth = 0, seen = new Set<unknown>()): string {
    if (depth > 4 || value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '';
    seen.add(value);
    const record = value as Record<string, unknown>;
    return [record.code, record.statusMessage, record.message, record.cause, record.data, record.error]
        .map((item) => collect(item, depth + 1, seen))
        .filter(Boolean)
        .join(' ');
}

export function chatErrorHintKey(error: unknown): ChatErrorHintKey | null {
    const text = collect(error);
    if (!text) return null;
    if (/TOOL_TIMEOUT|超时/.test(text)) return 'chat.errorHintTimeout';
    if (/TOOL_ABORTED|已中止|aborted/i.test(text)) return 'chat.errorHintAborted';
    if (/TOOL_DENIED|审批拒绝|已拒绝/.test(text)) return 'chat.errorHintDenied';
    if (/FS_STALE_VERSION|文件已被(外部)?修改|expectedVersion/i.test(text)) return 'chat.errorHintStaleFile';
    if (/rate_limited|too many requests|过于频繁|429/i.test(text)) return 'chat.errorHintRateLimited';
    if (/payload_too_large|请求体过大|413|超过.*上限/i.test(text)) return 'chat.errorHintTooLarge';
    if (/WORK_FILE_ROOTS|文件白名单|本地文件.*未启用|local_roots/.test(text)) return 'chat.errorHintFileRoots';
    if (/upstream_failed|供应商|fetch failed|ECONNREFUSED|502|503/i.test(text)) return 'chat.errorHintUpstream';
    if (/forbidden|403|无权|不允许/.test(text)) return 'chat.errorHintForbidden';
    return null;
}
