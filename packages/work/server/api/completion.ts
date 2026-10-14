import { createDeepSeek } from '@ai-sdk/deepseek';
import { streamText } from 'ai';
import { LOCAL_OWNER } from '../utils/owner';
import { rateLimit } from '../utils/rate-limit';
import { capBody, readCappedJsonBody } from '../utils/request-body';

/** 入参截断上限（字符）与输出上限（token）：给正常补全留足空间，同时封死任意长文本直灌模型的成本面 */
const PROMPT_MAX_CHARS = 8_000;
const MAX_OUTPUT_TOKENS = 2_048;

/**
 * 模型侧流预算，与 /api/chat 同一档位：DeepSeek 接受连接后不回首块、或吐半截就停摆时，
 * `toUIMessageStreamResponse()` 会把这条 SSE 挂到 undici 的默认上限（实测约 300 秒，见 /api/chat 的 `TOOL_TIMEOUT_MS` 注释）——
 * 期间 onError/onFinish 都不触发，连接不回收，而 20 次/分的限流是按次计数的，
 * 这 300 秒里同一批连接可以一直被占着。按步计数的首块/块间隔不会误杀长回答。
 */
const FIRST_CHUNK_TIMEOUT_MS = 60_000;
const CHUNK_TIMEOUT_MS = 60_000;

export default defineLazyEventHandler(async () => {
    const deepSeek = createDeepSeek({
        apiKey: useRuntimeConfig().deepseekApiKey,
    });
    return defineEventHandler(async (event: any) => {
        await capBody(event);
        // 该链路不走主 chat 的能力与历史编排，但同样调用真实模型；限流防止被无限刷取烧成本。
        const limited = await rateLimit(`completion:${LOCAL_OWNER}`, 20, 60_000);
        if (!limited.ok) {
            throw createError({ statusCode: 429, statusMessage: `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
        }
        // 空 body 时返回 undefined，下游按「prompt 必填」给 400；非法 JSON 与越限分别回 400/413。
        // 20 次/分的限流按**次数**计数，而 readBody 会把一条 chunked 大请求整个缓冲进内存，
        // 所以这条简化链路同样要按实际字节封顶。
        const body = await readCappedJsonBody<{ prompt?: unknown }>(event);
        const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
        if (!prompt) {
            throw createError({ statusCode: 400, statusMessage: 'prompt 必填' });
        }
        const result = streamText({
            model: deepSeek('deepseek-chat'),
            // 该端点定位是轻量补全：入参与输出都要有界，否则 20 次/分限流下成本仍然完全开放
            prompt: prompt.slice(0, PROMPT_MAX_CHARS),
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            timeout: { firstChunkMs: FIRST_CHUNK_TIMEOUT_MS, chunkMs: CHUNK_TIMEOUT_MS },
        });
        return result.toUIMessageStreamResponse();
    });
});
