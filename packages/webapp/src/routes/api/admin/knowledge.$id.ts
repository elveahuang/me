import { createFileRoute } from '@tanstack/react-router';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { knowledgeBases, knowledgeDocuments } from '@schema';
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';

type RouteParams = { request: Request; params: { id: string } };

const KbPatchSchema = z.object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).optional(),
    embeddingProviderId: z.number().int().positive().nullable().optional(),
    embeddingModel: z.string().max(100).nullable().optional(),
});

export const Route = createFileRoute('/api/admin/knowledge/$id')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '知识库 ID');
                    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id));
                    if (!kb) throw new HttpError(404, '知识库不存在');

                    const documents = await db
                        .select({
                            id: knowledgeDocuments.id,
                            title: knowledgeDocuments.title,
                            chunkCount: knowledgeDocuments.chunkCount,
                            status: knowledgeDocuments.status,
                            createdAt: knowledgeDocuments.createdAt,
                        })
                        .from(knowledgeDocuments)
                        .where(eq(knowledgeDocuments.kbId, id))
                        .orderBy(desc(knowledgeDocuments.createdAt));
                    return json({ ...kb, documents });
                } catch (e) {
                    return errorResponse(e);
                }
            },
            PATCH: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '知识库 ID');
                    const parsed = KbPatchSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const { embeddingProviderId, embeddingModel, ...rest } = parsed.data;

                    const [kb] = await db
                        .update(knowledgeBases)
                        .set({
                            ...rest,
                            ...(embeddingProviderId === undefined ? {} : { embeddingProviderId }),
                            ...(embeddingModel === undefined ? {} : { embeddingModel }),
                            updatedAt: new Date(),
                        })
                        .where(eq(knowledgeBases.id, id))
                        .returning();
                    if (!kb) throw new HttpError(404, '知识库不存在');
                    return json(kb);
                } catch (e) {
                    return errorResponse(e);
                }
            },
            DELETE: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '知识库 ID');
                    const deleted = await db.delete(knowledgeBases).where(eq(knowledgeBases.id, id)).returning({ id: knowledgeBases.id });
                    if (deleted.length === 0) throw new HttpError(404, '知识库不存在');
                    return json({ ok: true });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
