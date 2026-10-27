/**
 * 时间线里的文件 diff 提取（P3-2）。
 *
 * 不新增 `file/diff` 事件：`local_edit_file` 的 `tool/call` 入参已经完整带着 oldText/newText，
 * 结果事件只给状态。这里只做纯函数提取，时间线组件与冒烟测试共用同一份口径。
 */

export interface TimelineFileDiff {
    oldText: string;
    newText: string;
    /** 任一侧被截断时为 true，UI 需要提示「仅显示前 N 字符」 */
    truncated: boolean;
}

const DIFF_TEXT_MAX = 2000;

function pickText(input: unknown, key: string): string {
    if (!input || typeof input !== 'object') return '';
    const value = (input as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : '';
}

export function extractFileDiff(toolName: string, input: unknown): TimelineFileDiff | null {
    if (toolName !== 'local_edit_file') return null;
    const oldText = pickText(input, 'oldText');
    const newText = pickText(input, 'newText');
    if (!oldText && !newText) return null;
    return {
        oldText: oldText.length > DIFF_TEXT_MAX ? `${oldText.slice(0, DIFF_TEXT_MAX)}…` : oldText,
        newText: newText.length > DIFF_TEXT_MAX ? `${newText.slice(0, DIFF_TEXT_MAX)}…` : newText,
        truncated: oldText.length > DIFF_TEXT_MAX || newText.length > DIFF_TEXT_MAX,
    };
}
