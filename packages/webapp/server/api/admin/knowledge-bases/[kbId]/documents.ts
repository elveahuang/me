import { asc, eq } from 'drizzle-orm';
import { kbChunks, kbDocuments, knowledgeBases, providers } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { chunkText, embedTexts } from '../../../../utils/embedding';
import { requireAdmin } from '../../../../utils/guard';

/** 正文体积上限：两条上传通道共用，此前只有 multipart 分支受限，JSON 分支可以塞任意大小正文 */
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
/** 与 reindex 保持一致：嵌入接口按小批量提交，整篇一次请求容易超限或被供应商拒掉 */
const EMBED_BATCH_SIZE = 16;
/** 分块行同样分批插入：一条语句塞进上千行会撞 PostgreSQL 的参数量上限 */
const INSERT_BATCH_SIZE = 200;

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const kbId = getRouterParam(event, 'kbId')!;

    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    if (!kb) throw createError({ statusCode: 404, statusMessage: 'Knowledge base not found' });

    if (getMethod(event) === 'POST') {
        let title = '未命名文档';
        let content = '';

        const contentType = getHeader(event, 'content-type') ?? '';
        if (contentType.includes('multipart/form-data')) {
            const parts = (await readMultipartFormData(event)) ?? [];
            const filePart = parts.find((p) => p.name === 'file');
            const titlePart = parts.find((p) => p.name === 'title');
            if (!filePart) throw createError({ statusCode: 400, statusMessage: '缺少 file 字段' });
            content = filePart.data.toString('utf-8');
            title = titlePart?.data.toString('utf-8') || filePart.filename || '未命名文档';
        } else {
            const body = ((await readBody(event)) ?? {}) as { title?: unknown; content?: unknown };
            // 只接受字符串：数字/对象会让 drizzle 把非文本值带进 SQL 并抛 500
            title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '未命名文档';
            content = typeof body.content === 'string' ? body.content : '';
        }

        if (Buffer.byteLength(content, 'utf-8') > MAX_DOCUMENT_BYTES) {
            throw createError({ statusCode: 400, statusMessage: '文档内容超过 2MB 限制' });
        }
        if (!content.trim()) {
            throw createError({ statusCode: 400, statusMessage: '文档内容为空' });
        }

        // 解析嵌入供应商：KB 指定 > 默认启用供应商
        let provider = undefined;
        if (kb.embeddingProviderId) {
            [provider] = await db.select().from(providers).where(eq(providers.id, kb.embeddingProviderId));
        }
        if (!provider) {
            const rows = await db.select().from(providers).where(eq(providers.enabled, true));
            provider = rows.find((p) => p.isDefault) ?? rows[0];
        }
        // 分块 + 嵌入（具备向量失败自动降级纯文本索引机制）
        const chunks = chunkText(content);
        let vectors: number[][] = [];
        const providerName = provider?.name ?? '离线 Bigram 索引';

        if (provider) {
            for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
                const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
                try {
                    const batchVectors = await embedTexts(provider, kb.embeddingModel, batch);
                    // 供应商少返回时补空向量，保持 vectors 与 chunks 下标对齐
                    batch.forEach((_, j) => vectors.push(batchVectors[j] ?? []));
                } catch (error) {
                    console.warn(`[documents] 批次向量生成失败（offset=${i}），该批降级为 Bigram 纯文本索引:`, error);
                    batch.forEach(() => vectors.push([]));
                }
            }
        } else {
            vectors = chunks.map(() => []);
        }

        const docId = crypto.randomUUID();
        /**
         * 文档行与分块行必须同事务写入。
         * 分两次独立 insert 时，若分块写入失败会留下 chunkCount > 0 但实际无分块的文档，
         * 检索侧读到它会永远命中不到内容，且管理端只显示"已就绪"。
         */
        await db.transaction(async (tx) => {
            await tx.insert(kbDocuments).values({
                id: docId,
                kbId,
                title,
                content,
                chunkCount: chunks.length,
                status: 'ready',
            });
            for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
                const batch = chunks.slice(i, i + INSERT_BATCH_SIZE);
                await tx.insert(kbChunks).values(
                    batch.map((content_, j) => ({
                        id: crypto.randomUUID(),
                        kbId,
                        documentId: docId,
                        content: content_,
                        embedding: vectors[i + j] ?? [],
                    })),
                );
            }
        });

        const [row] = await db.select().from(kbDocuments).where(eq(kbDocuments.id, docId));
        return { ...row, provider: providerName };
    }

    // 文档列表限制条数：单个知识库可能有大量文档，全量返回会拖慢管理端。
    // 保持返回数组（管理端直接把响应赋给列表），只做上限截断而不改响应结构。
    // 不选 content：正文可能有整篇文档大小，列表页只需标题/分块数/状态，避免一次拉回全部正文。
    const query = getQuery(event);
    const limit = Math.min(Math.max(1, Math.floor(Number(query.limit)) || 200), 500);
    return db
        .select({
            id: kbDocuments.id,
            kbId: kbDocuments.kbId,
            title: kbDocuments.title,
            chunkCount: kbDocuments.chunkCount,
            status: kbDocuments.status,
            createdAt: kbDocuments.createdAt,
        })
        .from(kbDocuments)
        .where(eq(kbDocuments.kbId, kbId))
        .orderBy(asc(kbDocuments.createdAt))
        .limit(limit);
});
