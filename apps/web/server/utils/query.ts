import { stripNull } from './pg-text';

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
 *
 * NUL 也在这里收掉：模式串是**读路径**里唯一进 SQL 的用户文本，而带 U+0000 的参数
 * 会让 PostgreSQL 在驱动层直接失败（`invalid byte sequence for encoding "UTF8": 0x00`），
 * drizzle 把整条 `Failed query: select … from "schedules" …` 连同列清单写进响应体。
 * 写入侧早就经 `stripNull` 归一了，读侧漏一步是因为「搜索框里没人能打进 NUL」——
 * 但 URL 查询串算得出（`?keyword=%00bad`），粘贴带 NUL 的关键词经前端也会送上来。
 */
export function likePattern(keyword: string): string {
    const trimmed = stripNull(keyword).trim().slice(0, KEYWORD_MAX);
    return `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * 查询参数夹逼取整：负数（2201W）、小数（22P02）、NaN/Infinity 直接进 SQL 会被
 * PostgreSQL 拒绝并把 SQL 细节透出响应体，超大 page/offset 还会让 offset 溢出 int8。
 * 同一段 `Math.min(Math.max(min, Math.floor(Number(x)) || fallback), max)` 表达式此前
 * 在 10+ 个 handler 里整段复制，谁抄漏一个 `Math.floor` 或改错边界都不会被发现，收敛到这里。
 *
 * 只把「缺省/空白/非数字」折到 fallback，`0` 走 min 而不是 fallback：`?limit=0` 与 `?page=0`
 * 原写法会被 `|| fallback` 当成缺省，于是「只要 0 条」这种点击换来整页 500 条——
 * 越想要越少反而拿到越多，是把闸门反着用了。
 */
export function intParam(raw: unknown, fallback: number, min: number, max: number): number {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === null || value === '') return fallback;
    const num = Math.floor(Number(value));
    if (Number.isNaN(num)) return fallback;
    return Math.min(Math.max(min, num), max);
}

/**
 * 字符串查询参数取单值。
 *
 * `?status=todo&status=doing` 会让 h3 给出数组，而数组进 `eq()` 会被 postgres-js 展开成标量参数
 * → 500 并把 SQL 细节透出响应体（conversations.get.ts 已踩过一次）。重复参数按「取第一个」处理：
 * 语义上是客户端自己写错了，静默降级比报错更贴近「筛选条件照第一个走」。
 *
 * 与 `likePattern` 同一件事：这里也剔 NUL。取出来的值不止进 ILIKE，还直接进 `eq()`
 * （附件的 `category`、会话的 `agentId`），带 U+0000 一样是驱动层报错 + SQL 外泄。
 */
export function stringParam(raw: unknown, max = 128): string | undefined {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') return undefined;
    const trimmed = stripNull(value).trim().slice(0, max);
    return trimmed || undefined;
}

/**
 * 开关型查询参数（`?force=1`、`?download=true`）。
 *
 * 之前这些参数是裸标量比较：`getQuery(event).force === '1'`。客户端写成
 * `?force=1&force=1`（表单重复提交、axios 的 `params` 传了数组）时 h3 给出 `['1','1']`，
 * 比较整体落空、开关静默变回「关」——用户点「强制删除」拿到 409 却不知道为什么，
 * 点「下载」拿到的还是预览地址，界面上一句错误都没有。先按 `stringParam` 取单值再认，
 * 重复参数照第一个走，与其余筛选参数同一口径。
 */
export function flagParam(raw: unknown): boolean {
    const value = stringParam(raw);
    return value === '1' || value === 'true';
}
