import { auth } from '../../utils/auth';
import { requireAdmin } from '../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const query = getQuery(event);
    // 分页参数夹到合法区间并取整：负数会被下游查询拒绝并透出内部错误，小数同样不是合法的行数
    const result = await auth.api.listUsers({
        query: {
            limit: Math.min(Math.max(1, Math.floor(Number(query.limit)) || 50), 200),
            offset: Math.max(0, Math.floor(Number(query.offset)) || 0),
            searchValue: (query.q as string) || undefined,
            searchField: 'email',
            searchOperator: 'contains',
        },
        headers: event.headers,
    });
    return result;
});
