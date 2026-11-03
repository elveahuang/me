import { readJobOutput } from '../../utils/jobs';
import { requireMethod } from '../../utils/method';
import { intParam } from '../../utils/query';
import { capBody } from '../../utils/request-body';

export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    await capBody(event);
    const id = getRouterParam(event, 'id');
    if (!id) throw createError({ statusCode: 400, statusMessage: '缺少作业 id' });
    const query = getQuery(event);
    const afterSeq = intParam(query.afterSeq, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(query.limit, 100, 1, 200);
    return await readJobOutput(id, afterSeq, limit);
});
