import { asc, eq, sql } from 'drizzle-orm';
import { kbChunks, kbDocuments, knowledgeBases, providers, spaces } from '../../db/schema';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { safeTrim, stripNull } from '../../utils/pg-text';
import { stringParam } from '../../utils/query';
import { assertProviderExists } from '../../utils/providers';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../utils/request-body';
import { resolveOptionalSpaceId } from '../../utils/spaces';

export default defineEventHandler(async (event) => {
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);

    // 其余方法（PUT/PATCH/DELETE）原本落进下面的读取分支：请求拿到 200 + 列表，看起来像写成功了
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        // 对齐 skills/tools：trim 后非空、限长 100；非字符串（对象/数字）不允许直写 text 列
        const name = safeTrim(body.name);
        if (!name) {
            throw createError({ statusCode: 400, statusMessage: 'name 必填' });
        }
        if (name.length > 100) {
            throw createError({ statusCode: 400, statusMessage: 'name 过长（最多 100 字符）' });
        }
        const embeddingProviderId = await assertProviderExists(body.embeddingProviderId, '向量模型供应商');
        const spaceId = await resolveOptionalSpaceId(body.spaceId);
        const id = crypto.randomUUID();
        await db.insert(knowledgeBases).values({
            id,
            spaceId,
            name,
            description: typeof body.description === 'string' ? stripNull(body.description).slice(0, 500) : '',
            embeddingProviderId,
            embeddingModel: safeTrim(body.embeddingModel).slice(0, 100) || 'text-embedding-3-small',
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
    const requestedSpaceId = stringParam(getQuery(event).spaceId);
    const spaceId = requestedSpaceId ? await resolveOptionalSpaceId(requestedSpaceId) : null;

    const [rows, docCounts, chunkCounts, providerRows, spaceRows] = await Promise.all([
        db.select().from(knowledgeBases).where(spaceId ? eq(knowledgeBases.spaceId, spaceId) : undefined).orderBy(asc(knowledgeBases.createdAt)),
        db
            .select({ kbId: kbDocuments.kbId, count: sql<number>`count(*)::int` })
            .from(kbDocuments)
            .groupBy(kbDocuments.kbId),
        db
            .select({ kbId: kbChunks.kbId, count: sql<number>`count(*)::int` })
            .from(kbChunks)
            .groupBy(kbChunks.kbId),
        db.select({ id: providers.id, name: providers.name }).from(providers),
        db.select({ id: spaces.id, name: spaces.name }).from(spaces),
    ]);

    const docMap = new Map(docCounts.map((row) => [row.kbId, row.count]));
    const chunkMap = new Map(chunkCounts.map((row) => [row.kbId, row.count]));
    const providerMap = new Map(providerRows.map((row) => [row.id, row.name]));
    const spaceMap = new Map(spaceRows.map((row) => [row.id, row.name]));

    return rows.map((kb) => ({
        ...kb,
        providerName: kb.embeddingProviderId ? providerMap.get(kb.embeddingProviderId) : undefined,
        spaceName: kb.spaceId ? spaceMap.get(kb.spaceId) : undefined,
        documentCount: docMap.get(kb.id) ?? 0,
        chunkCount: chunkMap.get(kb.id) ?? 0,
    }));
});
