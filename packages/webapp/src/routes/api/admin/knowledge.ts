import { createFileRoute } from '@tanstack/react-router';
import { asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { knowledgeBases, knowledgeDocuments } from '@schema';
import { errorResponse, HttpError, json, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';

const KbBodySchema = z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).default(''),
    // 可选：指定用于向量化的供应商与 embedding 模型
    embeddingProviderId: z.number().int().positive().nullable().optional(),
    embeddingModel: z.string().max(100).nullable().optional(),
});

export const Route = createFileRoute('/api/admin/knowledge')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const list = await db
                        .select({
                            id: knowledgeBases.id,
                            name: knowledgeBases.name,
                            description: knowledgeBases.description,
                            embeddingProviderId: knowledgeBases.embeddingProviderId,
                            embeddingModel: knowledgeBases.embeddingModel,
                            createdAt: knowledgeBases.createdAt,
                            docCount: count(knowledgeDocuments.id),
                        })
                        .from(knowledgeBases)
                        .leftJoin(knowledgeDocuments, eq(knowledgeDocuments.kbId, knowledgeBases.id))
                        .groupBy(knowledgeBases.id)
                        .orderBy(asc(knowledgeBases.id));
                    return json(list.map((kb) => ({ ...kb, docCount: Number(kb.docCount) })));
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const parsed = KbBodySchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const { embeddingProviderId, embeddingModel, ...values } = parsed.data;
                    const [kb] = await db
                        .insert(knowledgeBases)
                        .values({
                            ...values,
                            ...(embeddingProviderId === undefined ? {} : { embeddingProviderId }),
                            ...(embeddingModel === undefined ? {} : { embeddingModel }),
                        })
                        .returning();
                    if (!kb) throw new HttpError(500, '创建知识库失败');
                    return json(kb, 201);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
