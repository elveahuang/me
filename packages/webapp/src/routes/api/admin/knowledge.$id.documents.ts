import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { knowledgeBases, knowledgeDocuments } from '@schema';
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { ingestDocument, MAX_DOCUMENT_CHARS } from '@/lib/rag';

type RouteParams = { request: Request; params: { id: string } };

const DocumentBodySchema = z.object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(MAX_DOCUMENT_CHARS),
});

/** 添加文档：切块 +（可选）向量化入库 */
export const Route = createFileRoute('/api/admin/knowledge/$id/documents')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            POST: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const kbId = parseId(params.id, '知识库 ID');
                    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
                    if (!kb) throw new HttpError(404, '知识库不存在');

                    const parsed = DocumentBodySchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);

                    const [document] = await db
                        .insert(knowledgeDocuments)
                        .values({ kbId, title: parsed.data.title, content: parsed.data.content })
                        .returning();
                    if (!document) throw new HttpError(500, '创建文档失败');

                    try {
                        const result = await ingestDocument({ kbId, documentId: document.id, content: parsed.data.content });
                        return json({ ...document, ...result }, 201);
                    } catch (e) {
                        // 入库失败时保留文档记录，标记错误并返回原因
                        console.error('[knowledge] 文档入库失败:', e);
                        await db
                            .update(knowledgeDocuments)
                            .set({ status: 'error' })
                            .where(eq(knowledgeDocuments.id, document.id));
                        return json(
                            { ...document, chunkCount: 0, embedded: false, error: e instanceof Error ? e.message : '入库失败' },
                            201,
                        );
                    }
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
