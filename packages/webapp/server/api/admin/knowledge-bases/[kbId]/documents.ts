import { asc, eq } from 'drizzle-orm';
import { kbChunks, kbDocuments, knowledgeBases, providers } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { chunkText, embedTexts } from '../../../../utils/embedding';
import { requireAdmin } from '../../../../utils/guard';

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
            if (filePart.data.length > 2 * 1024 * 1024) {
                throw createError({ statusCode: 400, statusMessage: '文件超过 2MB 限制' });
            }
            content = filePart.data.toString('utf-8');
            title = titlePart?.data.toString('utf-8') || filePart.filename || '未命名文档';
        } else {
            const body = await readBody(event);
            title = body.title || '未命名文档';
            content = body.content || '';
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
            try {
                vectors = await embedTexts(provider, kb.embeddingModel, chunks);
            } catch (error) {
                console.warn('[documents] 远程向量生成失败，降级为 Bigram 纯文本索引入库:', error);
                vectors = chunks.map(() => []);
            }
        } else {
            vectors = chunks.map(() => []);
        }

        const docId = crypto.randomUUID();
        await db.insert(kbDocuments).values({
            id: docId,
            kbId,
            title,
            content,
            chunkCount: chunks.length,
            status: 'ready',
        });
        await db.insert(kbChunks).values(
            chunks.map((content_, i) => ({
                id: crypto.randomUUID(),
                kbId,
                documentId: docId,
                content: content_,
                embedding: vectors[i] ?? [],
            })),
        );

        const [row] = await db.select().from(kbDocuments).where(eq(kbDocuments.id, docId));
        return { ...row, provider: providerName };
    }

    return db.select().from(kbDocuments).where(eq(kbDocuments.kbId, kbId)).orderBy(asc(kbDocuments.createdAt));
});
