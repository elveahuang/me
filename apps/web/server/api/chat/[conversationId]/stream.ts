import { createUIMessageStreamResponse } from 'ai';
import { createChatRunStream, getChatRun } from '../../../utils/chat-runs';
import { requireMethod } from '../../../utils/method';
import { routeId } from '../../../utils/route-id';

/**
 * 重连一条仍在生成（或刚刚生成完）的回复：`GET /api/chat/{会话 id}/stream`。
 *
 * 这是 AI SDK 客户端 `Chat.resumeStream()` 约定的地址——实例的 `id` 就是会话 id，
 * 所以路径段与它一致。返回体与当初那条 POST 响应逐条分片相同（见 `utils/chat-runs.ts`），
 * 客户端不必知道自己接上的是回放还是实时流。
 *
 * 没有可回放的轮次时回 **204**：客户端把实例状态复位成 `ready`，页面照常按数据库历史渲染。
 * 这一条是这个接口的主要出口（本轮已结束、缓冲已过宽限期、或缓冲溢出），所以不给 404。
 *
 * 只读、无副作用、不回传任何库内容，因此不需要 `blocksWrite`；`utils/chat-runs.ts` 自带
 * 条数/字节/宽限期三重上限，本机同时最多几轮，不会被这条路吃出内存问题。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    const conversationId = routeId(event, 'conversationId', '会话');

    const run = getChatRun(conversationId);
    if (!run) {
        setResponseStatus(event, 204);
        return '';
    }
    return createUIMessageStreamResponse({ stream: createChatRunStream(run) });
});
