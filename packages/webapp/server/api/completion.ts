import { createDeepSeek } from '@ai-sdk/deepseek';
import { streamText } from 'ai';
import { requireUser } from '../utils/guard';
import { rateLimit } from '../utils/rate-limit';

export default defineLazyEventHandler(async () => {
    const deepSeek = createDeepSeek({
        apiKey: useRuntimeConfig().deepseekApiKey,
    });
    return defineEventHandler(async (event: any) => {
        const session = await requireUser(event);
        // 该链路不走主 chat 的额度编排，但同样调用真实模型；限流防止被无限刷取烧成本。
        const limited = await rateLimit(`completion:${session.user.id}`, 20, 60_000);
        if (!limited.ok) {
            throw createError({ statusCode: 429, statusMessage: `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
        }
        // 空 body 时 readBody 返回 undefined，直接解构会抛 TypeError（500）。
        // 该链路不参与主 chat 的配额与历史编排，但至少要给出可读的 400。
        const body = (await readBody(event).catch(() => null)) as { prompt?: unknown } | null;
        const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
        if (!prompt) {
            throw createError({ statusCode: 400, statusMessage: 'prompt 必填' });
        }
        const result = streamText({
            model: deepSeek('deepseek-chat'),
            prompt,
        });
        return result.toUIMessageStreamResponse();
    });
});
