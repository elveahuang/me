import { eq } from 'drizzle-orm';
import { knowledgeBases } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    if (getMethod(event) === 'DELETE') {
        await db.delete(knowledgeBases).where(eq(knowledgeBases.id, id));
        return { ok: true };
    }

    const body = await readBody(event);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'description', 'embeddingModel'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    // 名称是必填项：前端已拦截，但接口层也要拒绝，避免脚本/直连写入无名知识库
    if (patch.name !== undefined && !String(patch.name).trim()) {
        throw createError({ statusCode: 400, statusMessage: '名称不能为空' });
    }
    if (body.embeddingProviderId !== undefined) patch.embeddingProviderId = body.embeddingProviderId || null;
    await db.update(knowledgeBases).set(patch).where(eq(knowledgeBases.id, id));
    const [row] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id));
    return row;
});
