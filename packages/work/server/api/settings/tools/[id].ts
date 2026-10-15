import { eq } from 'drizzle-orm';
import { tools } from '../../../db/schema';
import { normalizeAdminBoolean } from '../../../utils/admin-boolean';
import { normalizeToolConfig, normalizeToolDescription, normalizeToolName, normalizeToolType } from '../../../utils/admin-tool-input';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

export default defineEventHandler(async (event) => {
    const method = requireMethod(event, ['DELETE', 'PATCH']);
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    const id = routeId(event, 'id', '工具');

    if (method === 'DELETE') {
        // 0 行影响也要报出来：否则 id 抄错或行已被另一个管理员删掉时，界面照样提示「已删除」
        const deleted = await db.delete(tools).where(eq(tools.id, id)).returning({ id: tools.id });
        if (!deleted.length) throw createError({ statusCode: 404, statusMessage: '工具不存在' });
        return { ok: true };
    }

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
