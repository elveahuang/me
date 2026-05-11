import { ssl } from '@/core/db';
import collections from '@/payload/collections';
import { Admins } from '@/payload/collections/Admins.ts';
import { globals } from '@/payload/globals';
import { plugins } from '@/payload/plugins';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { nodemailerAdapter } from '@payloadcms/email-nodemailer';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import path from 'path';
import { buildConfig } from 'payload';
import { fileURLToPath } from 'url';

const filename: string = fileURLToPath(import.meta.url);
const dirname: string = path.dirname(filename);

export default buildConfig({
    admin: {
        user: Admins.slug,
        importMap: {
            baseDir: path.resolve(dirname),
        },
        suppressHydrationWarning: true,
    },
    collections: collections,
    globals: globals,
    editor: lexicalEditor(),
    secret: process.env.PAYLOAD_SECRET || '',
    typescript: {
        autoGenerate: true,
        strictDraftTypes: true,
        outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
    email: nodemailerAdapter({
        defaultFromAddress: process.env.SMTP_FROM || '',
        defaultFromName: process.env.SMTP_NAME || '',
        transportOptions: {
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        },
    }),
    db: postgresAdapter({
        pool: {
            connectionString: process.env.DATABASE_URL,
            ssl: ssl,
        },
        idType: 'uuid',
        generateSchemaOutputFile: path.resolve(dirname, 'payload-schema.ts'),
        migrationDir: path.resolve(dirname, 'migrations'),
    }),
    serverURL: process.env.NEXT_PUBLIC_SERVER_URL,
    plugins,
});
