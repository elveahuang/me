import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { user } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { intParam, likePattern } from '../../utils/query';

/** 角色筛选允许取值，其他值一律忽略（与订单列表约定一致，避免任意字符串进 SQL 条件） */
const USER_ROLES = new Set(['admin', 'editor', 'user']);

/**
 * 管理端用户列表：分页 + 服务端搜索（姓名/邮箱）+ 角色筛选。
 *
 * 此前走 better-auth listUsers 只回前 50 条，页面的总数/搜索/角色统计都在那 50 条里算，
 * 用户量超过 50 后必然系统性偏低。统计卡（总量/管理员/封禁）按全局聚合，不随筛选变化。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const query = getQuery(event);

    // 分页参数夹到合法区间并取整：负数/小数会被 PostgreSQL 拒绝并透出内部错误
    const pageSize = intParam(query.pageSize, 20, 1, 100);
    const page = intParam(query.page, 1, 1, 1e6);
    const offset = (page - 1) * pageSize;

    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
    const role = typeof query.role === 'string' && USER_ROLES.has(query.role) ? query.role : '';

    const conditions: SQL[] = [];
    if (keyword) {
        const pattern = likePattern(keyword);
        const matched = or(ilike(user.name, pattern), ilike(user.email, pattern));
        if (matched) conditions.push(matched);
    }
    if (role) conditions.push(eq(user.role, role));
    const where = conditions.length ? and(...conditions) : undefined;

    const [list, [filtered], [totals]] = await Promise.all([
        db
            .select({
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                banned: user.banned,
                createdAt: user.createdAt,
            })
            .from(user)
            .where(where)
            .orderBy(desc(user.createdAt))
            .limit(pageSize)
            .offset(offset),
        // 分页总数与统计都在库内聚合，不拉整表进内存
        db.select({ total: count() }).from(user).where(where),
        db
            .select({
                total: count(),
                adminCount: sql<number>`count(*) filter (where ${user.role} = 'admin')::int`,
                bannedCount: sql<number>`count(*) filter (where ${user.banned} is true)::int`,
            })
            .from(user),
    ]);

    const total = Number(filtered?.total ?? 0);
    return {
        users: list,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        stats: {
            total: Number(totals?.total ?? 0),
            adminCount: Number(totals?.adminCount ?? 0),
            bannedCount: Number(totals?.bannedCount ?? 0),
        },
    };
});
