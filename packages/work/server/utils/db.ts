import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '../db/schema';

// 兜底串刻意指向 work 自己的库名：fork 初期这里还是 webapp 的 `ee`，
// 忘配 POSTGRES_URL 时工作台会把自己的表写进 webapp 的库里。
const connectionString = process.env.POSTGRES_URL || 'postgres://postgres:postgres@localhost:5432/work';

const client: Sql = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });

/**
 * 关闭数据库连接池
 */
export async function closeDbClient(): Promise<void> {
    await client.end();
}
