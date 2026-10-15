import { and, eq, ne, sql } from 'drizzle-orm';
import { kbChunks, knowledgeBases } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { safeTrim, stripNull } from '../../../utils/pg-text';
import { assertProviderExists } from '../../../utils/providers';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

export default defineEventHandler(async (event) => {
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    // GET 曾会落进下面的更新分支（readBody 得空对象 → 只推进 updatedAt），读一次就改一次数据
    const method = requireMethod(event, ['PATCH', 'DELETE']);
    // 文件名与这里读的段名必须同为 kbId：radix3（h3 1.15 的路由匹配）在同一位置遇到
    // `:id` 与 `:kbId` 两个不同名的参数节点时，五段路径匹配不到任何路由，
    // `documents/[documentId].delete.ts` 会永远落进 SSR 兜底（设置页删除文档按钮 500）。
    const id = routeId(event, 'kbId', '知识库');

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
        const name = safeTrim(body.name);
        if (!name) throw createError({ statusCode: 400, statusMessage: '名称不能为空' });
        if (name.length > 100) throw createError({ statusCode: 400, statusMessage: 'name 过长（最多 100 字符）' });
        patch.name = name;
    }
    if (body.description !== undefined) patch.description = typeof body.description === 'string' ? stripNull(body.description).slice(0, 500) : '';
    if (body.embeddingModel !== undefined) {
        const model = safeTrim(body.embeddingModel);
        if (!model) throw createError({ statusCode: 400, statusMessage: 'embeddingModel 不能为空' });
        patch.embeddingModel = model.slice(0, 100);
    }
    if (body.embeddingProviderId !== undefined) patch.embeddingProviderId = await assertProviderExists(body.embeddingProviderId, '向量模型供应商');

    const [before] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id));
    if (!before) throw createError({ statusCode: 404, statusMessage: '知识库不存在' });

    /**
     * 换了嵌入口径就必须把旧向量作废，而且要在同一事务里做。
     *
     * `kb_chunks.embedding` 存的是 JSONB 数组、不是 pgvector，检索时只比「长度是否相等」
     * （embedding.ts 的 comparable 过滤）。同维度的换模型/换供应商——1536 的 text-embedding-3-small
     * 与另一家网关的 1536 维模型长度就相等——会通过那道过滤，于是新旧向量落在完全不同的语义空间里
     * 照样算得出「相关度 0.9x」，被当作依据注入提示词，日志一个字都不提。维度不同那一路至少有
     * console.warn，这一路是彻底静默的。留着旧向量也没有回退价值：它们对应的模型配置已经不存在了。
     * 清空后分块自然退回 Bigram 关键词检索（retrieveContext 的既有降级出口），
     * 管理端看到「分块没有向量」即可点「重建索引」按新模型重写。
     */
    const modelChanged = patch.embeddingModel !== undefined && patch.embeddingModel !== before.embeddingModel;
    const providerChanged = patch.embeddingProviderId !== undefined && (patch.embeddingProviderId ?? null) !== (before.embeddingProviderId ?? null);
    const embeddingStale = modelChanged || providerChanged;
    let vectorsInvalidated = 0;

    if (!embeddingStale) {
        await db.update(knowledgeBases).set(patch).where(eq(knowledgeBases.id, id));
    } else {
        await db.transaction(async (tx) => {
            await tx.update(knowledgeBases).set(patch).where(eq(knowledgeBases.id, id));
            // `ne(...,'[]'::jsonb)` 让本来就是空向量的分块不进这次 UPDATE：回传的数字必须是
            // 「这一轮真的作废了多少个」，不能是整库分块数（否则改一次模型就报「毁了 500 块」，
            // 而那 500 块里可能一个向量都没有，用户会以为保存操作造成了损失）。
            const cleared = await tx
                .update(kbChunks)
                .set({ embedding: sql`'[]'::jsonb` })
                .where(and(eq(kbChunks.kbId, id), ne(kbChunks.embedding, sql`'[]'::jsonb`)))
                .returning({ id: kbChunks.id });
            vectorsInvalidated = cleared.length;
        });
    }

    const [row] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '知识库不存在' });
    return embeddingStale ? { ...row, vectorsInvalidated } : row;
});
