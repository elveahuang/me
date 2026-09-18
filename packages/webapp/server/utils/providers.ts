import { createOpenAI } from '@ai-sdk/openai';
import { and, asc, eq } from 'drizzle-orm';
import type { Provider } from '../db/schema';
import { providers } from '../db/schema';
import { db } from './db';

/**
 * 模型供应商解析：所有供应商按 OpenAI 兼容协议接入
 * （DeepSeek / 通义 / OpenAI / 自建网关等，改 baseUrl 即可）。
 */

/** 环境变量里的 DeepSeek Key（过滤掉 .env.example 的占位符） */
function envDeepseekKey(): string {
    const raw = (process.env.NUXT_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim();
    return raw && !raw.includes('xxxx') ? raw : '';
}

/**
 * 保证存在默认供应商。
 *
 * 注意回填逻辑：早期版本在环境变量缺失时创建了 apiKey 为空的行，
 * 之后再配置 NUXT_DEEPSEEK_API_KEY 也不会生效（管理端看不到原因、对话直接 400）。
 * 因此这里对「默认且 Key 为空」的行做一次环境变量回填。
 */
export async function ensureDefaultProvider() {
    const usableKey = envDeepseekKey();
    const [existing] = await db.select().from(providers).orderBy(asc(providers.createdAt)).limit(1);

    if (existing) {
        if (!usableKey) return;
        const emptyKeyDefaults = await db
            .select({ id: providers.id, name: providers.name })
            .from(providers)
            .where(and(eq(providers.apiKey, ''), eq(providers.isDefault, true)));
        for (const row of emptyKeyDefaults) {
            await db.update(providers).set({ apiKey: usableKey, updatedAt: new Date() }).where(eq(providers.id, row.id));
            console.info(`[providers] 已用环境变量回填供应商「${row.name}」的 API Key`);
        }
        return;
    }

    await db.insert(providers).values({
        id: crypto.randomUUID(),
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: usableKey,
        models: ['deepseek-chat', 'deepseek-reasoner'],
        enabled: true,
        isDefault: true,
    });
}

export async function getEnabledProviders(): Promise<Provider[]> {
    return db.select().from(providers).where(eq(providers.enabled, true)).orderBy(asc(providers.createdAt));
}

/**
 * 只读地探测模型可用性，不写库。
 *
 * 供健康检查等**无鉴权**的探针使用：resolveModel() 会调用 ensureDefaultProvider()，
 * 在 providers 表为空时插入一行默认供应商——那意味着任何人都能通过 GET /api/health
 * 触发数据库写入。探针只应读状态，不应有副作用。
 */
export async function peekModelAvailability(): Promise<{ available: boolean; providerName?: string; modelId?: string; reason?: string }> {
    const enabled = await getEnabledProviders();
    if (!enabled.length) {
        return { available: false, reason: '尚未配置模型供应商' };
    }
    const provider = enabled.find((p) => p.isDefault) ?? enabled[0]!;
    if (!provider.apiKey) {
        return { available: false, providerName: provider.name, reason: '供应商未配置 API Key' };
    }
    return { available: true, providerName: provider.name, modelId: 'deepseek-chat' };
}

/** 解析智能体要用的模型；未指定供应商时回退到默认（第一个启用的）供应商。 */
export async function resolveModel(providerId?: string | null, modelId?: string | null) {
    await ensureDefaultProvider();

    let provider: Provider | undefined;
    if (providerId) {
        [provider] = await db.select().from(providers).where(eq(providers.id, providerId));
    }
    if (!provider || !provider.enabled) {
        const enabled = await getEnabledProviders();
        provider = enabled.find((p) => p.isDefault) ?? enabled[0];
    }
    if (!provider) {
        throw createError({ statusCode: 400, statusMessage: '没有可用的模型供应商，请先在管理后台配置' });
    }
    if (!provider.apiKey) {
        throw createError({ statusCode: 400, statusMessage: `供应商「${provider.name}」未配置 API Key` });
    }

    const openai = createOpenAI({ baseURL: provider.baseUrl, apiKey: provider.apiKey });
    // 第三方 OpenAI 兼容端点普遍只实现 chat/completions，明确走 .chat 而非默认的 responses API
    const resolvedModelId = modelId || 'deepseek-chat';
    return { provider, modelId: resolvedModelId, model: openai.chat(resolvedModelId) };
}
