import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '../db/schema';

// 兜底串刻意指向 work 自己的库名：fork 初期这里还是 webapp 的 `ee`，
// 忘配 POSTGRES_URL 时工作台会把自己的表写进 webapp 的库里。
const connectionString = process.env.POSTGRES_URL || 'postgres://postgres:postgres@localhost:5432/work';

/**
 * 会话时区固定 UTC，是为了让两种时间写法落在同一个坐标系里。
 *
 * 这些列都是 `timestamp`（不带时区）：应用侧写进去的是 Drizzle 按 UTC 渲染的墙钟
 * （送 `2026-10-20T00:00:00Z` → 存 `2026-10-20 00:00:00`，读回来仍是同一个瞬间），
 * 而 `.defaultNow()` 走的是数据库的 `now()`，会按**会话 TimeZone** 折成墙钟。
 * 库端 TimeZone 默认继承主机时区（本机 Asia/Shanghai，容器又常是 UTC），
 * 于是同一行的 `created_at`（北京墙钟）与 `updated_at`（UTC 墙钟）能差出 8 小时：
 * 「创建 9 毫秒后更新」在库里变成 updated_at 比 created_at 早 8 小时，
 * 按 updatedAt 排序的最近笔记/任务会把刚改过的排到最后，接口把创建时间报成未来 8 小时，
 * 「今天到期」这类窗口也整体偏移。把会话按 UTC 打开后两侧同框架，且不再随部署主机时区变。
 *
 * 只影响之后写入的墙钟口径：改动前落库的行仍带着当时那个时区的墙钟，
 * 要校正历史数据得单独做一次回填，不属于这里。
 */
const client: Sql = postgres(connectionString, { prepare: false, connection: { options: '-c TimeZone=UTC' } });

export const db = drizzle(client, { schema });

/**
 * 关闭数据库连接池
 */
export async function closeDbClient(): Promise<void> {
    await client.end();
}
