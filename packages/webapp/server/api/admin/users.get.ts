import { auth } from '../../utils/auth';
import { requireAdmin } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const query = getQuery(event);
    const result = await auth.api.listUsers({
        query: {
            limit: Number(query.limit) || 50,
            offset: Number(query.offset) || 0,
            searchValue: (query.q as string) || undefined,
            searchField: 'email',
            searchOperator: 'contains',
        },
        headers: event.headers,
    });
    return result;
});
