import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export type DB = NodePgDatabase & { $client: Pool };

export const isVercelEnv: boolean = (process.env.DATABASE_PRODIVER || 'local') === 'vercel';

export const ssl: false | { rejectUnauthorized: false } = isVercelEnv
    ? {
          rejectUnauthorized: false,
      }
    : false;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: ssl,
});

export const db: DB = drizzle(pool);
