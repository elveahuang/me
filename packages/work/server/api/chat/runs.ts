import { runningConversationIds } from '../../utils/chat-runs';
import { requireMethod } from '../../utils/method';

/**
 * 仍在后台生成的会话 id 列表：`GET /api/chat/runs`。
 *
 * 存在理由：客户端的「生成中」状态挂在 Chat 实例上，刷新页面后实例没了，但那一轮在服务端可能还在跑
 * （见 `utils/chat-runs.ts`）。侧栏只有拿到这份列表才能把「生成中」标出来，而不是让那条会话看起来
 * 像一条已经聊完的普通历史。
 *
 * 只回 id，不带标题/正文，避免把会话内容透出到一条没有状态的接口上。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    return { ids: runningConversationIds() };
});
