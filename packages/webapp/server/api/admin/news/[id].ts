import { eq } from 'drizzle-orm';
import { news } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

const EDITABLE = ['title', 'summary', 'content', 'coverImage', 'category', 'status'] as const;

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
    const method = getMethod(event);

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
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of EDITABLE) {
        if (body[key] !== undefined) patch[key] = body[key] === null ? '' : String(body[key]);
    }
    if (patch.title !== undefined && !String(patch.title).trim()) {
        throw createError({ statusCode: 400, statusMessage: '标题不能为空' });
    }
    if (body.tags !== undefined) {
        patch.tags = Array.isArray(body.tags) ? body.tags.map((v: unknown) => String(v).trim()).filter(Boolean) : [];
    }
    if (body.pinned !== undefined) patch.pinned = Boolean(body.pinned);
    if (body.publishedAt !== undefined) {
        patch.publishedAt = body.publishedAt ? new Date(String(body.publishedAt)) : null;
    }
    // 草稿 → 发布 且从未设置过发布时间时补当前时间
    if (patch.status === 'published' && existing.status !== 'published' && !existing.publishedAt && body.publishedAt === undefined) {
        patch.publishedAt = new Date();
    }

    await db.update(news).set(patch).where(eq(news.id, id));
    const [row] = await db.select().from(news).where(eq(news.id, id));
    return row;
});
