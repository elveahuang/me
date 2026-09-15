import { asc, eq } from 'drizzle-orm';
import { kbChunks, knowledgeBases, providers } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { embedTexts } from '../../../../utils/embedding';
import { requireAdmin } from '../../../../utils/guard';

const BATCH_SIZE = 16;

/**
 * 重建知识库向量索引。
 *
 * 文档入库时若嵌入接口异常，会以空向量落库并降级为关键词检索；
 * 这里提供补偿入口：重新调用 /embeddings 为所有分块生成向量。
 *
 * 注意：目录名使用 [kbId]（与同级 [id].ts 区分），避免同段 param 名冲突导致路由匹配异常。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const kbId = getRouterParam(event, 'kbId')!;

    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    if (!kb) throw createError({ statusCode: 404, statusMessage: 'Knowledge base not found' });

    let provider = undefined;
    if (kb.embeddingProviderId) {
        [provider] = await db.select().from(providers).where(eq(providers.id, kb.embeddingProviderId));
    }
    if (!provider) {
        const rows = await db.select().from(providers).where(eq(providers.enabled, true));
        provider = rows.find((p) => p.isDefault) ?? rows[0];
    }
    if (!provider) {
        throw createError({ statusCode: 400, statusMessage: '没有可用的嵌入供应商，请先在「模型供应商」中配置' });
    }

    const chunks = await db
        .select({ id: kbChunks.id, content: kbChunks.content })
        .from(kbChunks)
        .where(eq(kbChunks.kbId, kbId))
        .orderBy(asc(kbChunks.createdAt));

    let updated = 0;
    let failed = 0;
    let lastError: string | null = null;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        try {
            const vectors = await embedTexts(
                provider,
                kb.embeddingModel,
                batch.map((c) => c.content),
            );
            for (let j = 0; j < batch.length; j++) {
                const vector = vectors[j];
                if (!vector?.length) {
                    failed++;
                    continue;
                }
                await db.update(kbChunks).set({ embedding: vector }).where(eq(kbChunks.id, batch[j]!.id));
                updated++;
            }
        } catch (error) {
            console.error(`[reindex] 批次失败（kb=${kbId} offset=${i}）:`, error);
            failed += batch.length;
            lastError = error instanceof Error ? error.message : String(error);
        }
    }

    return {
        ok: failed === 0,
        knowledgeBase: { id: kb.id, name: kb.name, embeddingModel: kb.embeddingModel, provider: provider.name },
        total: chunks.length,
        updated,
        failed,
        lastError,
    };
});
