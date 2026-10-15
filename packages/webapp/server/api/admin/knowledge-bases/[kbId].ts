import { eq } from 'drizzle-orm';
import { knowledgeBases } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { requireMethod } from '../../../utils/method';
import { assertProviderExists } from '../../../utils/providers';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    // GET 曾会落进下面的更新分支（readBody 得空对象 → 只推进 updatedAt），读一次就改一次数据
    const method = requireMethod(event, ['PATCH', 'DELETE']);
    // 文件名与这里读的段名必须同为 kbId：radix3（h3 1.15 的路由匹配）在同一位置遇到
    // `:id` 与 `:kbId` 两个不同名的参数节点时，五段路径直接匹配不到任何路由，
    // `documents/[documentId].delete.ts` 会永远落进 SSR 兜底（管理端删除文档按钮 500）。
    const id = getRouterParam(event, 'kbId')!;

    if (method === 'DELETE') {
        // 文档与分块跟着级联消失，所以「删了个不存在的库」绝不能被报成成功
        const deleted = await db.delete(knowledgeBases).where(eq(knowledgeBases.id, id)).returning({ id: knowledgeBases.id });
        if (!deleted.length) throw createError({ statusCode: 404, statusMessage: '知识库不存在' });
        return { ok: true };
    }

    const body = (await readBody(event)) ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    // 逐字段归一：非字符串会被 postgres-js 拒成 500 并透出 SQL 细节，这里统一改 400
    if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) throw createError({ statusCode: 400, statusMessage: '名称不能为空' });
        if (name.length > 100) throw createError({ statusCode: 400, statusMessage: 'name 过长（最多 100 字符）' });
        patch.name = name;
    }
    if (body.description !== undefined) patch.description = typeof body.description === 'string' ? body.description.slice(0, 500) : '';
    if (body.embeddingModel !== undefined) {
        const model = typeof body.embeddingModel === 'string' ? body.embeddingModel.trim() : '';
        if (!model) throw createError({ statusCode: 400, statusMessage: 'embeddingModel 不能为空' });
        patch.embeddingModel = model.slice(0, 100);
    }
    if (body.embeddingProviderId !== undefined) patch.embeddingProviderId = await assertProviderExists(body.embeddingProviderId, '向量模型供应商');
    await db.update(knowledgeBases).set(patch).where(eq(knowledgeBases.id, id));
    const [row] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '知识库不存在' });
    return row;
});
