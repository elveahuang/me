import { killBackgroundJob } from '../../../utils/jobs';
import { requireMethod } from '../../../utils/method';
import { rateLimit } from '../../../utils/rate-limit';
import { capBody } from '../../../utils/request-body';

export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);
    const id = getRouterParam(event, 'id');
    if (!id) throw createError({ statusCode: 400, statusMessage: '缺少作业 id' });
    const limited = await rateLimit(`jobs:kill:${id}`, 20, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: `操作过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    await capBody(event);
    const killed = await killBackgroundJob(id);
    if (!killed) throw createError({ statusCode: 409, statusMessage: '作业不存在或已经结束' });
    return { id, killed: true };
});
