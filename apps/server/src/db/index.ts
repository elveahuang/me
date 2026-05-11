import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const client = postgres(process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/postgres');
export const db = drizzle(client, { schema });
