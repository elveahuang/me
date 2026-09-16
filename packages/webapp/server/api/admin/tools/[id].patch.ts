import { eq } from 'drizzle-orm';
import { tools } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const body = await readBody(event);

    // 更新 HTTP 工具的 URL 时校验协议（仅允许 http/https）
    if (body.config?.url !== undefined) {
        let parsed: URL;
        try {
            parsed = new URL(body.config.url);
        } catch {
            throw createError({ statusCode: 400, statusMessage: 'config.url 不是合法 URL' });
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw createError({ statusCode: 400, statusMessage: 'config.url 仅允许 http/https 协议' });
        }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'description', 'type', 'config', 'enabled'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    await db.update(tools).set(patch).where(eq(tools.id, id));
    const [row] = await db.select().from(tools).where(eq(tools.id, id));
    return row;
});
