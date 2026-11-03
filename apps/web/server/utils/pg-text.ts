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

/**
 * 递归剔除任意 JSON 结构里每个字符串（含对象键）中的 NUL，返回新的结构。
 *
 * 给 jsonb 列用的：`stripNull()` 只能救「一个已知字符串字段」这种形状，
 * 而 jsonb 的值是一整棵树——聊天消息的 `parts` 里，`data` part 的载荷、`file` part 的
 * filename、工具输出的嵌套字段都可能是字符串，逐字段点名必然漏。漏一个就是一条
 * `Failed query: insert into "messages" (...)` 连同整张列清单进响应体。
 *
 * 用显式栈而不是递归：入参形状由客户端决定，`[[[[…]]]]` 套到几万层时递归版本
 * 会先栈溢出，等于把「500 + SQL 外泄」换成另一种 500。
 */
export function stripNullDeep<T>(value: T): T {
    if (typeof value === 'string') return stripNull(value) as unknown as T;
    // Date 不含 NUL，且不能退化成 {}（jsonb 里会丢时间），原样交给驱动的序列化
    if (value === null || typeof value !== 'object' || value instanceof Date) return value;

    const root: object = Array.isArray(value) ? [] : {};
    const stack: Array<{ src: object; dst: object }> = [{ src: value, dst: root }];
    const set = (dst: object, key: string | number, item: unknown) => {
        (dst as Record<string | number, unknown>)[key] = item;
    };
    while (stack.length) {
        const { src, dst } = stack.pop()!;
        const entries: Array<[string | number, unknown]> = Array.isArray(src)
            ? src.map((item, index) => [index, item] as [number, unknown])
            : Object.entries(src as Record<string, unknown>);
        for (const [rawKey, item] of entries) {
            // 对象键同样进 SQL 文本：{"a\u0000b": 1} 一样触发 22021
            const key = typeof rawKey === 'string' ? stripNull(rawKey) : rawKey;
            if (item !== null && typeof item === 'object' && !(item instanceof Date)) {
                const child: object = Array.isArray(item) ? [] : {};
                set(dst, key, child);
                stack.push({ src: item, dst: child });
                continue;
            }
            set(dst, key, typeof item === 'string' ? stripNull(item) : item);
        }
    }
    return root as T;
}
