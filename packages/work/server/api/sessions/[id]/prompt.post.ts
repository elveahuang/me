import { sendRedirect } from 'h3';
import { requireMethod } from '../../../utils/method';
import { routeId } from '../../../utils/route-id';

/**
 * v2 适配层：保留旧 `/api/chat` 的 UI message stream 语义，本端点只是带方法保持的 307。
 * 请求体原样转发，因此 `requestId`（8–128 位字母数字/`._-`）也在这里生效：
 * 同一会话 + 同一 requestId 的 running/completed 轮次返回 409，不重复调用模型；
 * failed/aborted/interrupted 允许用同一个 id 重试。
 */
export default defineEventHandler((event) => {
    requireMethod(event, ['POST']);
    const id = routeId(event, 'id', '会话');
    return sendRedirect(event, `/api/chat?conversationId=${encodeURIComponent(id)}`, 307);
});
