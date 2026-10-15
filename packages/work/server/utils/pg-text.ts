/**
 * PostgreSQL 文本列的一条硬约束：值里不能有 U+0000。
 *
 * 带 NUL 的参数会在驱动层直接失败（`invalid byte sequence for encoding "UTF8": 0x00`），
 * 而 drizzle 把整条 `Failed query: insert into "skills" (...)` 连同列名一起写进响应体——
 * 一个粘贴动作就能把表结构与列清单透出界面，所以这一层必须在入参归一时收掉。
 *
 * 归一策略是**剔除**而不是拒绝：NUL 的现实来源是粘贴（终端输出、二进制片段、
 * 被截断的 UTF-16），用户看不到它，为看不见的字符报 400 只会让人反复重试。
 * 换行、制表符是正文的正常内容，刻意不处理，所以这里只认 \u0000。
 */
export function stripNull(value: string): string {
    // 绝大多数请求不含 NUL，先 includes 短路，避免每条正文都过一次 replace
    return value.includes('\u0000') ? value.replaceAll('\u0000', '') : value;
}

/** 未知入参 → 安全文本：非字符串按空串处理，顺带剔掉 NUL。 */
export function toText(raw: unknown): string {
    return typeof raw === 'string' ? stripNull(raw) : '';
}

/**
 * handler 里到处都是 `typeof x === 'string' ? x.trim() : ''` 这一行：
 * 它缺了 stripNull，就是「名字里粘一个 NUL → 500 + SQL 细节」的那条路径。
 * 收敛成一个函数，让必填判定（空串）与落库值走同一份归一。
 */
export function safeTrim(raw: unknown): string {
    return toText(raw).trim();
}
