import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema';

const connectionString = process.env.POSTGRES_URL || 'postgres://postgres:postgres@localhost:5432/ee';

const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
