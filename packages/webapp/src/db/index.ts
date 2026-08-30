import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://root:root@localhost:5432/me',
});

export const db = drizzle(pool, { schema });
