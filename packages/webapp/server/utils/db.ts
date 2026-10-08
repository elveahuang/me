import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '../db/schema';

const connectionString = process.env.POSTGRES_URL || 'postgres://postgres:postgres@localhost:5432/ee';

const client: Sql = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });

/**
 * 关闭数据库连接池
 */
export async function closeDbClient(): Promise<void> {
    await client.end();
}
