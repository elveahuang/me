import { asc, eq, sql } from 'drizzle-orm';
import { kbChunks, kbDocuments, knowledgeBases, providers } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { assertProviderExists } from '../../utils/providers';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = (await readBody(event)) ?? {};
        if (!body.name) {
            throw createError({ statusCode: 400, statusMessage: 'name 必填' });
        }
        const embeddingProviderId = await assertProviderExists(body.embeddingProviderId, '向量模型供应商');
        const id = crypto.randomUUID();
        await db.insert(knowledgeBases).values({
            id,
            name: body.name,
            description: body.description ?? '',
            embeddingProviderId,
            embeddingModel: body.embeddingModel ?? 'text-embedding-3-small',
        });
        const [row] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id));
        return row;
    }

    /**
     * 统计只取聚合结果。
     * 此前把 kb_documents / kb_chunks 的全部行查进内存再 filter 计数：
     * chunk 表随文档增长会到百万级，列表接口会因此变成全表扫描 + 大内存占用。
     * 四条查询互不依赖，一次并发发出。
     */
    const [rows, docCounts, chunkCounts, providerRows] = await Promise.all([
        db.select().from(knowledgeBases).orderBy(asc(knowledgeBases.createdAt)),
        db
            .select({ kbId: kbDocuments.kbId, count: sql<number>`count(*)::int` })
            .from(kbDocuments)
            .groupBy(kbDocuments.kbId),
        db
            .select({ kbId: kbChunks.kbId, count: sql<number>`count(*)::int` })
            .from(kbChunks)
            .groupBy(kbChunks.kbId),
        db.select({ id: providers.id, name: providers.name }).from(providers),
    ]);

    const docMap = new Map(docCounts.map((row) => [row.kbId, row.count]));
    const chunkMap = new Map(chunkCounts.map((row) => [row.kbId, row.count]));
    const providerMap = new Map(providerRows.map((row) => [row.id, row.name]));

    return rows.map((kb) => ({
        ...kb,
        providerName: kb.embeddingProviderId ? providerMap.get(kb.embeddingProviderId) : undefined,
        documentCount: docMap.get(kb.id) ?? 0,
        chunkCount: chunkMap.get(kb.id) ?? 0,
    }));
});
