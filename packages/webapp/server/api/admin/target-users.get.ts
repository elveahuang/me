import { desc, sql } from 'drizzle-orm';
import { user } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { intParam, likePattern } from '../../utils/query';

/**
 * 定向推送的用户选择器数据源。
 * 只返回选择所需的最小字段（id / 名称 / 邮箱），支持关键词搜索与条数上限，
 * 避免把整张用户表暴露给前端下拉框。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const query = getQuery(event);
    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
    const limit = intParam(query.limit, 30, 1, 100);

    const where = keyword ? sql`${user.name} ilike ${likePattern(keyword)} or ${user.email} ilike ${likePattern(keyword)}` : undefined;

    const rows = await db
        .select({ id: user.id, name: user.name, email: user.email, role: user.role })
        .from(user)
        .where(where)
        .orderBy(desc(user.createdAt))
        .limit(limit);

    const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(user)
        .where(where);
    return { users: rows, total: totalRow?.count ?? 0 };
});
