/** 关键词进入 ILIKE 前的最大字符数。 */
const KEYWORD_MAX = 128;

/**
 * 把用户输入的关键词转成 `contains` 语义的 ILIKE 模式。
 *
 * 必须转义 `\`、`%`、`_`：不转义时它们是通配符，搜「100%」会命中整张表、
 * 搜「a_b」连 `axb` 一起命中，管理端的筛选结果直接说谎；关键词本身还可能是
 * 一整串 `%`，让本就用不上索引的 `ilike '%…%'` 扫描更贵，所以先夹长度。
 * 值是以参数形式送进 PostgreSQL 的（drizzle 的参数化 / sql 模板），
 * 因此这里只需按 LIKE 模式转义，不需要考虑 SQL 文本转义。
 */
export function likePattern(keyword: string): string {
    const trimmed = keyword.trim().slice(0, KEYWORD_MAX);
    return `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * 查询参数夹逼取整：负数（2201W）、小数（22P02）、NaN/Infinity 直接进 SQL 会被
 * PostgreSQL 拒绝并把 SQL 细节透出响应体，超大 page/offset 还会让 offset 溢出 int8。
 * 同一段 `Math.min(Math.max(min, Math.floor(Number(x)) || fallback), max)` 表达式此前
 * 在 10+ 个 handler 里整段复制，谁抄漏一个 `Math.floor` 或改错边界都不会被发现，收敛到这里。
 */
export function intParam(raw: unknown, fallback: number, min: number, max: number): number {
    return Math.min(Math.max(min, Math.floor(Number(raw)) || fallback), max);
}
