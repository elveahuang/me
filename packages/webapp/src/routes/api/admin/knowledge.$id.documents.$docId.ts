import { db } from '@/db';
import { errorResponse, HttpError, json, parseId, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { ingestDocument } from '@/lib/rag';
import { knowledgeChunks, knowledgeDocuments } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { and, eq } from 'drizzle-orm';

type RouteParams = { request: Request; params: { id: string; docId: string } };

/** 删除文档 / 重新入库（改了 embedding 配置后重建向量） */
export const Route = createFileRoute('/api/admin/knowledge/$id/documents/$docId')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            DELETE: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const kbId = parseId(params.id, '知识库 ID');
                    const docId = parseId(params.docId, '文档 ID');
                    // 归属校验：docId 必须属于路径中的知识库
                    const deleted = await db
                        .delete(knowledgeDocuments)
                        .where(and(eq(knowledgeDocuments.id, docId), eq(knowledgeDocuments.kbId, kbId)))
                        .returning({ id: knowledgeDocuments.id });
                    if (deleted.length === 0) throw new HttpError(404, '文档不存在');
                    return json({ ok: true });
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const kbId = parseId(params.id, '知识库 ID');
                    const docId = parseId(params.docId, '文档 ID');
                    // 归属校验：docId 必须属于路径中的知识库
                    const [document] = await db
                        .select()
                        .from(knowledgeDocuments)
                        .where(and(eq(knowledgeDocuments.id, docId), eq(knowledgeDocuments.kbId, kbId)));
                    if (!document) throw new HttpError(404, '文档不存在');

                    // 先清掉旧块
                    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, docId));
                    try {
                        const result = await ingestDocument({
                            kbId: document.kbId,
                            documentId: document.id,
                            content: document.content,
                        });
                        return json({ ok: true, ...result });
                    } catch (e) {
                        // 重建失败时保留文档记录并标记错误，避免状态与数据不一致
                        console.error('[knowledge] 文档重建向量失败:', e);
                        await db.update(knowledgeDocuments).set({ status: 'error' }).where(eq(knowledgeDocuments.id, document.id));
                        return json({ ok: true, chunkCount: 0, embedded: false, error: e instanceof Error ? e.message : '重建向量失败' });
                    }
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
