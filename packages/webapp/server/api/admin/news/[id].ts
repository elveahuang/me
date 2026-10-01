import { eq } from 'drizzle-orm';
import { news } from '../../../db/schema';
import { normalizeNewsBody } from '../../../utils/content-ops';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { requireMethod } from '../../../utils/method';

/**
 * 资讯详情（GET）/ 更新（PATCH）/ 删除（DELETE）。
 *
 * 注意：管理端列表接口不返回 content（避免列表页传输大量 Markdown），
 * 因此编辑正文前必须先 GET 详情，否则回填为空、一保存就覆盖原文。
 * GET 分支必须显式处理：此前未区分方法，任何请求都会走更新分支并写库。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    // GET 分支已显式处理；再收窄白名单，PUT/POST 等不再落进下面的更新分支
    const method = requireMethod(event, ['GET', 'PATCH', 'DELETE']);

    const [existing] = await db.select().from(news).where(eq(news.id, id));
    if (!existing) throw createError({ statusCode: 404, statusMessage: '资讯不存在' });

    if (method === 'GET') {
        return existing;
    }

    if (method === 'DELETE') {
        await db.delete(news).where(eq(news.id, id));
        return { ok: true };
    }

    const body = (await readBody(event)) ?? {};
    // 归一（含 status 枚举收窄、title trim、分类空值回退、published 必有发布时间的不变式）
    // 与 POST 共用 normalizeNewsBody；existing 传入以便「补发布时间」读旧行
    const patch: Record<string, unknown> = { updatedAt: new Date(), ...normalizeNewsBody(body, { existing }) };

    await db.update(news).set(patch).where(eq(news.id, id));
    const [row] = await db.select().from(news).where(eq(news.id, id));
    return row;
});
