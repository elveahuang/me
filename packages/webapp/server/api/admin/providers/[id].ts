import { eq } from 'drizzle-orm';
import { providers } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

function maskKey(key: string) {
    if (!key) return '';
    return key.length <= 8 ? '****' : `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    if (getMethod(event) === 'DELETE') {
        await db.delete(providers).where(eq(providers.id, id));
        return { ok: true };
    }

    const body = await readBody(event);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'baseUrl', 'enabled', 'isDefault'] as const) {
        if (body[key] !== undefined) patch[key] = key === 'baseUrl' ? String(body[key]).replace(/\/+$/, '') : body[key];
    }
    if (Array.isArray(body.models)) patch.models = body.models;
    // apiKey 只有在明确传入新值时才更新（掩码回传不覆盖真实 key）
    if (typeof body.apiKey === 'string' && body.apiKey && !body.apiKey.includes('****')) {
        patch.apiKey = body.apiKey;
    }
    await db.update(providers).set(patch).where(eq(providers.id, id));
    const [row] = await db.select().from(providers).where(eq(providers.id, id));
    return { ...row!, apiKey: maskKey(row!.apiKey) };
});
