import { eq } from 'drizzle-orm';
import { tools } from '../../../db/schema';
import { normalizeAdminBoolean } from '../../../utils/admin-boolean';
import { normalizeToolConfig, normalizeToolDescription, normalizeToolName, normalizeToolType } from '../../../utils/admin-tool-input';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const body = (await readBody(event)) ?? {};

    // config.url 的协议/形态校验同样在 normalizeToolConfig 内（POST 与 PATCH 共用一份规则）
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = normalizeToolName(body.name);
    if (body.description !== undefined) patch.description = normalizeToolDescription(body.description);
    if (body.type !== undefined) patch.type = normalizeToolType(body.type);
    if (body.config !== undefined) patch.config = normalizeToolConfig(body.config);
    if (body.enabled !== undefined) patch.enabled = normalizeAdminBoolean(body.enabled, 'enabled', true);
    await db.update(tools).set(patch).where(eq(tools.id, id));
    const [row] = await db.select().from(tools).where(eq(tools.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '工具不存在' });
    return row;
});
