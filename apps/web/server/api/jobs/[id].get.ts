import { readJobOutput } from '../../utils/jobs';
import { requireMethod } from '../../utils/method';
import { intParam } from '../../utils/query';
import { capBody } from '../../utils/request-body';
import { prefixedRouteId } from '../../utils/route-id';

export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    await capBody(event);
    const id = prefixedRouteId(event, 'job_', 'id', '作业');
    const query = getQuery(event);
    const afterSeq = intParam(query.afterSeq, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(query.limit, 100, 1, 200);
    return await readJobOutput(id, afterSeq, limit);
});
