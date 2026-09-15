import { asc, eq } from 'drizzle-orm';
import { providers } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { ensureDefaultProvider } from '../../utils/providers';

function maskKey(key: string) {
    if (!key) return '';
    return key.length <= 8 ? '****' : `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = await readBody(event);
        if (!body.name || !body.baseUrl) {
            throw createError({ statusCode: 400, statusMessage: 'name 和 baseUrl 必填' });
        }
        const id = crypto.randomUUID();
        await db.insert(providers).values({
            id,
            name: body.name,
            baseUrl: body.baseUrl.replace(/\/+$/, ''),
            apiKey: body.apiKey ?? '',
            models: body.models ?? [],
            enabled: body.enabled ?? true,
            isDefault: body.isDefault ?? false,
        });
        const [row] = await db.select().from(providers).where(eq(providers.id, id));
        return { ...row!, apiKey: maskKey(row!.apiKey) };
    }

    await ensureDefaultProvider();
    const rows = await db.select().from(providers).orderBy(asc(providers.createdAt));
    return rows.map((p) => ({ ...p, apiKey: maskKey(p.apiKey) }));
});
