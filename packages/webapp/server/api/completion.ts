import { createDeepSeek } from '@ai-sdk/deepseek';
import { streamText } from 'ai';
import { requireUser } from '../utils/guard';

export default defineLazyEventHandler(async () => {
    const deepSeek = createDeepSeek({
        apiKey: useRuntimeConfig().deepseekApiKey,
    });
    return defineEventHandler(async (event: any) => {
        await requireUser(event);
        const { prompt } = await readBody(event);
        const result = streamText({
            model: deepSeek('deepseek-chat'),
            prompt,
        });
        return result.toUIMessageStreamResponse();
    });
});
