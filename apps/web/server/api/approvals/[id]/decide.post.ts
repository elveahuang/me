import { decideApproval } from '../../../agent/policy/approval';
import { requireMethod } from '../../../utils/method';
import { rateLimit } from '../../../utils/rate-limit';
import { readCappedJsonBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);
    const id = routeId(event, 'id', '审批');
    const limited = await rateLimit(`approval:${id}`, 10, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: `操作过于频繁，请 ${limited.retryAfterSec} 秒后再试` });

    const body = await readCappedJsonBody<{ decision?: unknown; reason?: unknown }>(event, 4 * 1024);
    const decision = body?.decision;
    if (decision !== 'allow' && decision !== 'deny') {
        throw createError({ statusCode: 400, statusMessage: 'decision 必须是 allow 或 deny' });
    }
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : '';
    const ok = await decideApproval(id, decision, reason);
    if (!ok) throw createError({ statusCode: 404, statusMessage: '审批不存在或已经处理' });
    return { ok: true, decision };
});
