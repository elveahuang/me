import { db } from '@/db';
import { errorResponse, HttpError, json, readJson, requireAdmin } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { aiProviders } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { asc } from 'drizzle-orm';
import { z } from 'zod';

const ProviderBodySchema = z.object({
    name: z.string().min(1).max(50),
    protocol: z.enum(['openai-compatible', 'deepseek']).default('openai-compatible'),
    baseUrl: z.string().url().max(500),
    apiKey: z.string().max(500).default(''),
    embeddingModel: z.string().max(100).nullable().optional(),
    enabled: z.boolean().default(true),
});

function maskKey(key: string) {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export const Route = createFileRoute('/api/admin/providers')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const list = await db.select().from(aiProviders).orderBy(asc(aiProviders.id));
                    // 不回传完整 key，只给掩码
                    return json(list.map((p) => ({ ...p, apiKey: maskKey(p.apiKey), hasKey: p.apiKey.length > 0 })));
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const parsed = ProviderBodySchema.safeParse(await readJson<unknown>(request));
                    if (!parsed.success) throw new HttpError(400, `参数错误: ${parsed.error.issues[0]?.message ?? ''}`);
                    const [provider] = await db.insert(aiProviders).values(parsed.data).returning();
                    if (!provider) throw new HttpError(500, '创建供应商失败');
                    return json({ ...provider, apiKey: maskKey(provider.apiKey) }, 201);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
