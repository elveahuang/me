import { abortChatRun } from '../../../utils/chat-runs';
import { requireMethod } from '../../../utils/method';
import { LOCAL_OWNER } from '../../../utils/owner';
import { rateLimit } from '../../../utils/rate-limit';
import { routeId } from '../../../utils/route-id';

/**
 * 中断一段会话仍在生成的那一轮：`POST /api/chat/{会话 id}/stop`。
 *
 * 为什么必须有它：`Chat.stop()` 只撕掉浏览器那侧的 fetch，服务端仍会把模型读完、把整条回复落库
 * （这正是「切页面/刷新不打断生成」的实现，见 `utils/chat-runs.ts`）。于是点「停止」变成
 * 「看不见但照烧」——token、供应商额度与 MCP 连接一样不少。这个接口把 abort 信号送到
 * `streamText({ abortSignal })`，那一轮以中断收尾，`onFinish` 仍保存已产出的部分回复。
 *
 * 幂等：这一轮刚好自己跑完时回 `stopped: false`，不是 404——客户端按下按钮与服务端收尾之间
 * 本来就有竞态，把它做成错误只会让界面多弹一条「停止失败」。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);

    const limited = await rateLimit(`chat-stop:${LOCAL_OWNER}`, 60, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }

    const conversationId = routeId(event, 'conversationId', '会话');
    return { stopped: abortChatRun(conversationId) };
});
