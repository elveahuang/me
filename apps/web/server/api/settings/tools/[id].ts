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

    const [existing] = await db.select().from(tools).where(eq(tools.id, id));
    if (!existing) throw createError({ statusCode: 404, statusMessage: '工具不存在' });

    // config.url 的协议/形态校验同样在 normalizeToolConfig 内（POST 与 PATCH 共用一份规则）
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = normalizeToolName(body.name);
    if (body.description !== undefined) patch.description = normalizeToolDescription(body.description);
    if (body.type !== undefined) patch.type = normalizeToolType(body.type);
    if (body.config !== undefined) patch.config = normalizeToolConfig(body.config);
    if (body.enabled !== undefined) patch.enabled = normalizeAdminBoolean(body.enabled, 'enabled', true);
    /**
     * 按「合并后的行」判 HTTP 工具必须有 url，而不是只看请求里带了什么。
     *
     * 把一条 builtin_time 改成 http、或在改别的字段时顺手把 config 整份替换成不含 url 的对象，
     * 每一处输入都合法，落库后却是一条永远不会成功的工具：模型每次调用都抛错，管理员毫无线索。
     * POST 侧一直有这道闸门，PATCH 漏掉它就等于给同一条不变量留了后门。
     */
    const nextType = (patch.type as string | undefined) ?? existing.type;
    const nextConfig = (patch.config as Record<string, unknown> | undefined) ?? existing.config;
    if (nextType === 'http' && !nextConfig.url) {
        throw createError({ statusCode: 400, statusMessage: 'HTTP 工具必须配置 config.url' });
    }
    await db.update(tools).set(patch).where(eq(tools.id, id));
    const [row] = await db.select().from(tools).where(eq(tools.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '工具不存在' });
    return row;
});
