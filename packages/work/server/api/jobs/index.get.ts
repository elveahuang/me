import { listJobs } from '../../utils/jobs';
import { requireMethod } from '../../utils/method';
import { intParam } from '../../utils/query';
import { capBody } from '../../utils/request-body';

export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    await capBody(event);
    const query = getQuery(event);
    const conversationId = typeof query.conversationId === 'string' ? query.conversationId.trim() : '';
    const limit = intParam(query.limit, 30, 1, 100);
    const jobs = await listJobs(conversationId || null, limit);
    return { jobs };
});
