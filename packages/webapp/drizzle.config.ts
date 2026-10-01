import { defineConfig } from 'drizzle-kit';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

function loadEnv() {
    try {
        const content = readFileSync(resolve(__dirname, '.env'), 'utf8');
        for (const line of content.split('\n')) {
            const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (match && !process.env[match[1]]) {
                process.env[match[1]] = match[2];
            }
        }
    } catch {
        // .env is optional
    }
}

loadEnv();

export default defineConfig({
    dialect: 'postgresql',
    schema: './server/db/schema.ts',
    out: './server/db/migrations',
    dbCredentials: {
        url: process.env.POSTGRES_URL!,
    },
});
