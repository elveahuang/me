import { and, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { orders, user } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { intParam, likePattern } from '../../utils/query';

/** 允许按状态筛选的取值，其他值一律忽略（避免把任意字符串带进 SQL 条件） */
const ORDER_STATUSES = new Set(['pending', 'paid', 'closed', 'refunded']);

/**
 * 管理端订单列表：分页 + 状态/关键字/时间范围筛选，并返回同一筛选条件下的聚合统计。
 *
 * 统计放在服务端而不是前端求和：此前页面把「最近 200 条里 paid 的金额」当作累计营收，
 * 订单量超过一页后数字会系统性偏低。聚合与列表共用同一组筛选条件，
 * 因此选定时间范围时卡片即成为该区间的对账汇总。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const query = getQuery(event);

    // 分页参数夹到合法区间并取整：负数/小数会作为非法行数被 PostgreSQL 拒绝并透出内部错误
    const pageSize = intParam(query.pageSize, 20, 1, 100);
    const page = intParam(query.page, 1, 1, 1e6);
    const offset = (page - 1) * pageSize;

    const status = typeof query.status === 'string' && ORDER_STATUSES.has(query.status) ? query.status : null;
    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';

    const conditions: SQL[] = [];
    if (status) conditions.push(eq(orders.status, status));
    if (keyword) {
        // 与列表页的搜索维度一致：订单号 / 用户邮箱 / 套餐编码
        const pattern = likePattern(keyword);
        const matched = or(ilike(orders.orderNo, pattern), ilike(user.email, pattern), ilike(orders.planCode, pattern));
        if (matched) conditions.push(matched);
    }
    // 时间范围按「下单时间」过滤，接受 ISO 日期或日期时间；非法值直接忽略而不是报错
    const from = parseDateBoundary(query.dateFrom);
    if (from) conditions.push(gte(orders.createdAt, from));
    const to = parseDateBoundary(query.dateTo, true);
    if (to) conditions.push(lte(orders.createdAt, to));

    const where = conditions.length ? and(...conditions) : undefined;

    const [list, [totals]] = await Promise.all([
        db
            .select({
                id: orders.id,
                orderNo: orders.orderNo,
                userEmail: user.email,
                planCode: orders.planCode,
                period: orders.period,
                amountCents: orders.amountCents,
                status: orders.status,
                provider: orders.provider,
                providerTradeNo: orders.providerTradeNo,
                paidAt: orders.paidAt,
                createdAt: orders.createdAt,
            })
            .from(orders)
            .leftJoin(user, eq(orders.userId, user.id))
            .where(where)
            .orderBy(desc(orders.createdAt))
            .limit(pageSize)
            .offset(offset),
        // 聚合在数据库完成：计数与金额都由 SQL 汇总，避免把整表拉进内存
        db
            .select({
                total: count(),
                paidCount: sql<number>`count(*) filter (where ${orders.status} = 'paid')::int`,
                pendingCount: sql<number>`count(*) filter (where ${orders.status} = 'pending')::int`,
                closedCount: sql<number>`count(*) filter (where ${orders.status} = 'closed')::int`,
                refundedCount: sql<number>`count(*) filter (where ${orders.status} = 'refunded')::int`,
                // 营收扣除已退款订单：退款成功的订单不再计入到账金额。
                // 必须 cast 成 bigint：amount_cents 是 integer，PostgreSQL 的 sum(integer) 返回 bigint，
                // 收成 int4 后累计到账超过 2^31-1 分（约 2147 万元）就会抛 22003，把整页订单连同统计一起变 500。
                paidAmountCents: sql<number>`coalesce(sum(${orders.amountCents}) filter (where ${orders.status} = 'paid'), 0)::bigint`,
            })
            .from(orders)
            .leftJoin(user, eq(orders.userId, user.id))
            .where(where),
    ]);

    const total = Number(totals?.total ?? 0);
    return {
        orders: list,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        stats: {
            total,
            paidCount: Number(totals?.paidCount ?? 0),
            pendingCount: Number(totals?.pendingCount ?? 0),
            closedCount: Number(totals?.closedCount ?? 0),
            refundedCount: Number(totals?.refundedCount ?? 0),
            paidAmountCents: Number(totals?.paidAmountCents ?? 0),
        },
    };
});

/** 解析时间筛选边界；isEnd 为真时补到当天 23:59:59.999，否则从 00:00:00.000 起 */
function parseDateBoundary(value: unknown, isEnd = false): Date | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const raw = value.trim();
    // 纯日期（YYYY-MM-DD）按当天边界补全，避免结束日期被解析成当天零点而漏掉当天订单
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const parsed = new Date(dateOnly && isEnd ? `${raw}T23:59:59.999` : dateOnly ? `${raw}T00:00:00.000` : raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
