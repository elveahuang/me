import { db } from '@/db';
import { errorResponse, HttpError, json, parseId, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { ingestDocument } from '@/lib/rag';
import { knowledgeChunks, knowledgeDocuments } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';

type RouteParams = { request: Request; params: { id: string; docId: string } };

/** 删除文档 / 重新入库（改了 embedding 配置后重建向量） */
export const Route = createFileRoute('/api/admin/knowledge/$id/documents/$docId')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            DELETE: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const docId = parseId(params.docId, '文档 ID');
                    const deleted = await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId)).returning({ id: knowledgeDocuments.id });
                    if (deleted.length === 0) throw new HttpError(404, '文档不存在');
                    return json({ ok: true });
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const docId = parseId(params.docId, '文档 ID');
                    const [document] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId));
                    if (!document) throw new HttpError(404, '文档不存在');

                    // 先清掉旧块
                    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, docId));
                    const result = await ingestDocument({
                        kbId: document.kbId,
                        documentId: document.id,
                        content: document.content,
                    });
                    return json({ ok: true, ...result });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
