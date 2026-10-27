import { runningConversationIds } from '../../utils/chat-runs';
import { requireMethod } from '../../utils/method';
import { runningSessionRunConversationIds } from '../../utils/session-runs';

/**
 * 仍在后台生成的会话 id 列表：`GET /api/chat/runs`。
 *
 * 存在理由：客户端的「生成中」状态挂在 Chat 实例上，刷新页面后实例没了，但那一轮在服务端可能还在跑
 * （见 `utils/chat-runs.ts`）。侧栏只有拿到这份列表才能把「生成中」标出来，而不是让那条会话看起来
 * 像一条已经聊完的普通历史。
 *
 * 内存缓冲与 `session_runs` 台账取并集：前者能立刻反映本进程刚起的轮次，后者让进程重启前的
 * 在途行也有解释（启动清理会把它们标成 interrupted，因此不会永久误报）。
 *
 * 只回 id，不带标题/正文，避免把会话内容透出到一条没有状态的接口上。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    const ids = new Set(runningConversationIds());
    for (const id of await runningSessionRunConversationIds()) ids.add(id);
    return { ids: [...ids] };
});
