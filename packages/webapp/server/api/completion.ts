import { createDeepSeek } from '@ai-sdk/deepseek';
import { streamText } from 'ai';
import { requireUser } from '../utils/guard';

export default defineLazyEventHandler(async () => {
    const deepSeek = createDeepSeek({
        apiKey: useRuntimeConfig().deepseekApiKey,
    });
    return defineEventHandler(async (event: any) => {
        await requireUser(event);
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
