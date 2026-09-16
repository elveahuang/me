import { eq } from 'drizzle-orm';
import { providers } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { requireAdmin } from '../../../../utils/guard';

/** 连通测试：请求 OpenAI 兼容的 /models，成功则把模型列表写回 provider。 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const [provider] = await db.select().from(providers).where(eq(providers.id, id));
    if (!provider) {
        throw createError({ statusCode: 404, statusMessage: 'Provider not found' });
    }

    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    let res: Response;
    try {
        res = await fetch(`${baseUrl}/models`, {
            headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
            signal: AbortSignal.timeout(15000),
        });
    } catch (error) {
        return { ok: false, message: `连接失败：${error instanceof Error ? error.message : String(error)}` };
    }

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, message: `HTTP ${res.status}：${body.slice(0, 300)}` };
    }

    let modelIds: string[] = [];
    try {
        const json = (await res.json()) as { data?: { id: string }[] };
        modelIds = (json.data ?? [])
            .map((m) => m.id)
            .filter(Boolean)
            .sort();
    } catch {
        return { ok: true, message: '连接成功，但 /models 响应无法解析出模型列表', models: provider.models };
    }

    if (modelIds.length) {
        await db.update(providers).set({ models: modelIds, updatedAt: new Date() }).where(eq(providers.id, id));
    }
    return { ok: true, message: `连接成功，发现 ${modelIds.length} 个模型`, models: modelIds };
});
