import { eq } from 'drizzle-orm';
import { providers } from '../../../../db/schema';
import { normalizeProviderModels } from '../../../../utils/admin-provider-input';
import { db } from '../../../../utils/db';
import { gateExpensiveCalls } from '../../../../utils/expensive-gate';
import { requireMethod } from '../../../../utils/method';
import { readCappedResponseText } from '../../../../utils/outbound';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../../utils/request-body';
import { routeId } from '../../../../utils/route-id';

/** 失败响应只需要前 300 字符给人看，多留一点余量给多字节文本 */
const ERROR_BODY_MAX_BYTES = 2_000;

/** /models 清单的读取上限：正常清单远小于此，超限说明对端不是 OpenAI 兼容端点 */
const MODELS_BODY_MAX_BYTES = 2_000_000;

/** 连通测试：请求 OpenAI 兼容的 /models，成功则把模型列表写回 provider。 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    const id = routeId(event, 'id', '供应商');
    // 一次请求 = 一发对上游 /models 的真实外呼（15 秒预算），成功还会覆盖 provider.models。
    // 前端已有逐行在途判定（W22），这里是服务端这一层：脚本与多标签页不受那个按钮约束。
    await gateExpensiveCalls(`provider-test:${id}`, '连通测试', 20);
    const [provider] = await db.select().from(providers).where(eq(providers.id, id));
    if (!provider) {
        throw createError({ statusCode: 404, statusMessage: '供应商不存在' });
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
        const { text } = await readCappedResponseText(res, ERROR_BODY_MAX_BYTES).catch(() => ({ text: '' }));
        return { ok: false, message: `HTTP ${res.status}：${text.slice(0, 300)}` };
    }

    let modelIds: string[] = [];
    try {
        const { text, truncated } = await readCappedResponseText(res, MODELS_BODY_MAX_BYTES);
        // 被截断的响应必然不是完整 JSON，也不该拿半截清单去覆盖 provider.models
        if (truncated) throw new Error('models list truncated');
        const json = JSON.parse(text) as { data?: unknown };
        if (!Array.isArray(json.data)) throw new Error('unexpected /models shape');
        // 上游返回不受我们控制：非字符串/空白/超长的 id 只丢单项，整表截到上限，
        // 否则脏清单会原样进 jsonb，再被 auto-config 与 self-config 拼进模型上下文。
        modelIds = normalizeProviderModels(
            json.data.map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : m)),
            'skip',
        ).sort();
    } catch {
        return { ok: true, message: '连接成功，但 /models 响应无法解析出模型列表', models: provider.models };
    }

    if (modelIds.length) {
        await db.update(providers).set({ models: modelIds, updatedAt: new Date() }).where(eq(providers.id, id));
    }
    return { ok: true, message: `连接成功，发现 ${modelIds.length} 个模型`, models: modelIds };
});
