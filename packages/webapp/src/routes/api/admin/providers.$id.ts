import { createFileRoute } from '@tanstack/react-router';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { aiProviders } from '@schema';
import { errorResponse, HttpError, json, parseId, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';

type RouteParams = { request: Request; params: { id: string } };

const ProviderPatchSchema = z.object({
    name: z.string().min(1).max(50).optional(),
    protocol: z.enum(['openai-compatible', 'deepseek']).optional(),
    baseUrl: z.string().url().max(500).optional(),
    // 特殊值 undefined 表示不修改；空字符串表示清空
    apiKey: z.string().max(500).optional(),
    embeddingModel: z.string().max(100).nullable().optional(),
    enabled: z.boolean().optional(),
});

export const Route = createFileRoute('/api/admin/providers/$id')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            PATCH: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '供应商 ID');
                    const parsed = ProviderPatchSchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);

                    const { apiKey, embeddingModel, ...rest } = parsed.data;
                    const [provider] = await db
                        .update(aiProviders)
                        .set({
                            ...rest,
                            ...(apiKey === undefined ? {} : { apiKey }),
                            ...(embeddingModel === undefined ? {} : { embeddingModel }),
                            updatedAt: new Date(),
                        })
                        .where(eq(aiProviders.id, id))
                        .returning();
                    if (!provider) throw new HttpError(404, '供应商不存在');
                    const masked = provider.apiKey ? `${provider.apiKey.slice(0, 4)}****${provider.apiKey.slice(-4)}` : '';
                    return json({ ...provider, apiKey: masked });
                } catch (e) {
                    return errorResponse(e);
                }
            },
            DELETE: async ({ request, params }: RouteParams) => {
                try {
                    await requireAdmin(request);
                    const id = parseId(params.id, '供应商 ID');
                    const deleted = await db.delete(aiProviders).where(eq(aiProviders.id, id)).returning({ id: aiProviders.id });
                    if (deleted.length === 0) throw new HttpError(404, '供应商不存在');
                    return json({ ok: true });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
