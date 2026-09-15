import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { membershipPlans, orders, usageCounters, userMemberships } from '../db/schema';
import { db } from './db';
import { cacheDel, cacheGetOrSet } from './redis';

/**
 * 计费核心：会员解析、订单创建与支付成功后的开通、每日配额。
 * 支付渠道细节见 server/utils/payments（本文件只面向订单表与会员表）。
 */

export type BillingPeriod = 'monthly' | 'yearly';

/** 订单支付超时（2 小时未支付自动关单展示） */
export const ORDER_TTL_MS = 2 * 60 * 60 * 1000;

/** 免费档兜底配额（membership_plans 缺 free 行时使用，防全站无限对话） */
export const DEFAULT_DAILY_QUOTA = 20;

/** 会员有效期：按周期顺延；已有未过期会员时从当前到期时间续期。月末日期 clamp 到目标月最后一天 */
function addPeriod(from: Date, period: BillingPeriod): Date {
    const next = new Date(from);
    const day = next.getDate();
    if (period === 'yearly') {
        next.setMonth(next.getMonth() + 12);
    } else {
        next.setMonth(next.getMonth() + 1);
    }
    // setMonth 溢出时会跳到下下月（如 1/31 + 1 月 → 3/3），回退到目标月最后一天
    if (next.getDate() !== day) next.setDate(0);
    return next;
}

/** 用量统计的日 key（UTC+8 归日，与国内用户的使用习惯一致） */
export function usagePeriodKey(now = new Date()): string {
    const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return cst.toISOString().slice(0, 10);
}

export interface Plan {
    id: string;
    code: string;
    name: string;
    description: string;
    chatQuotaPerDay: number | null;
    monthlyPriceCents: number;
    yearlyPriceCents: number | null;
    enabled: boolean;
    sortOrder: number;
}

const PLANS_CACHE_KEY = 'cache:plans:active';

async function queryPlansFromDb(includeDisabled: boolean): Promise<Plan[]> {
    const rows = includeDisabled
        ? await db.select().from(membershipPlans).orderBy(membershipPlans.sortOrder, membershipPlans.id)
        : await db.select().from(membershipPlans).where(eq(membershipPlans.enabled, true)).orderBy(membershipPlans.sortOrder, membershipPlans.id);
    return rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        chatQuotaPerDay: r.chatQuotaPerDay,
        monthlyPriceCents: r.monthlyPriceCents,
        yearlyPriceCents: r.yearlyPriceCents,
        enabled: r.enabled,
        sortOrder: r.sortOrder,
    }));
}

export async function listPlans(includeDisabled = false): Promise<Plan[]> {
    if (includeDisabled) {
        return queryPlansFromDb(true);
    }
    // 启用状态的套餐列表缓存 10 分钟，管理端修改时触发失效
    return cacheGetOrSet(PLANS_CACHE_KEY, 600, () => queryPlansFromDb(false));
}

/** 清理前台套餐列表缓存（管理端增删改套餐时调用） */
export async function invalidatePlansCache(): Promise<void> {
    await cacheDel(PLANS_CACHE_KEY);
}

export interface MembershipStatus {
    /** 当前生效套餐（无付费会员时为 free 档或 null） */
    plan: Plan | null;
    expiresAt: string | null;
    /** 每日配额（null 不限量） */
    chatQuotaPerDay: number | null;
    usedToday: number;
}

/** 解析用户当前会员：取 expiresAt 最晚且未过期的记录；无付费会员回退 free 档 */
export async function getMembershipStatus(userId: string): Promise<MembershipStatus> {
    const [current] = await db
        .select()
        .from(userMemberships)
        .where(and(eq(userMemberships.userId, userId), eq(userMemberships.status, 'active'), gt(userMemberships.expiresAt, new Date())))
        .orderBy(desc(userMemberships.expiresAt))
        .limit(1);

    let plan: Plan | null = null;
    if (current) {
        const [p] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, current.planId));
        if (p) {
            plan = {
                id: p.id,
                code: p.code,
                name: p.name,
                description: p.description,
                chatQuotaPerDay: p.chatQuotaPerDay,
                monthlyPriceCents: p.monthlyPriceCents,
                yearlyPriceCents: p.yearlyPriceCents,
                enabled: p.enabled,
                sortOrder: p.sortOrder,
            };
        }
    }
    if (!plan) {
        const [free] = await db.select().from(membershipPlans).where(eq(membershipPlans.code, 'free'));
        if (free) {
            plan = {
                id: free.id,
                code: free.code,
                name: free.name,
                description: free.description,
                chatQuotaPerDay: free.chatQuotaPerDay,
                monthlyPriceCents: 0,
                yearlyPriceCents: null,
                enabled: true,
                sortOrder: free.sortOrder,
            };
        }
    }

    // 无套餐记录时用硬编码兜底配额，防止 free 档被误删导致全站不限量
    const quota = plan ? plan.chatQuotaPerDay : DEFAULT_DAILY_QUOTA;
    const usedToday = quota === null ? 0 : await getTodayUsage(userId);
    return { plan, expiresAt: current?.expiresAt.toISOString() ?? null, chatQuotaPerDay: quota, usedToday };
}

/** 查询用户当日用量 */
export async function getTodayUsage(userId: string, now = new Date()): Promise<number> {
    const [row] = await db
        .select({ count: usageCounters.count })
        .from(usageCounters)
        .where(and(eq(usageCounters.userId, userId), eq(usageCounters.periodKey, usagePeriodKey(now))));
    return row?.count ?? 0;
}

/**
 * 原子地消耗一次对话配额：检查 + 计数在单条 UPDATE 内完成，杜绝"检查→记账"窗口被并发击穿。
 * 超出配额抛 402；配额为 null（不限量）直接放行。发起即计费（含失败请求，防滥用）。
 */
export async function consumeChatQuota(userId: string, now = new Date()): Promise<void> {
    const status = await getMembershipStatus(userId);
    const quota = status.chatQuotaPerDay;
    if (quota === null) return;
    if (status.usedToday >= quota) {
        throw createError({ statusCode: 402, statusMessage: `今日额度已用完（${quota} 次），升级会员可获得更多额度` });
    }
    const periodKey = usagePeriodKey(now);
    const inserted = await db
        .insert(usageCounters)
        .values({ id: crypto.randomUUID(), userId, periodKey, count: 1 })
        .onConflictDoUpdate({
            target: [usageCounters.userId, usageCounters.periodKey],
            set: { count: sql`${usageCounters.count} + 1`, updatedAt: new Date() },
            // 并发护栏：计数已达配额时不更新（返回 0 行）
            setWhere: sql`${usageCounters.count} < ${quota}`,
        })
        .returning({ count: usageCounters.count });
    if (!inserted[0]) {
        throw createError({ statusCode: 402, statusMessage: `今日额度已用完（${quota} 次），升级会员可获得更多额度` });
    }
}

/** 生成商户订单号 */
export function generateOrderNo(): string {
    return `mo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 创建订单（不含支付动作）；金额以套餐快照为准，不信任客户端 */
export async function createOrder(params: {
    userId: string;
    planId: string;
    period: BillingPeriod;
    provider: string;
}): Promise<{ order: typeof orders.$inferSelect; plan: Plan }> {
    const [plan] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, params.planId));
    if (!plan || !plan.enabled) {
        throw createError({ statusCode: 404, statusMessage: '套餐不存在或未开放' });
    }
    if (plan.code === 'free') {
        throw createError({ statusCode: 400, statusMessage: '免费套餐无需购买' });
    }

    const amountCents = params.period === 'yearly' ? plan.yearlyPriceCents : plan.monthlyPriceCents;
    if (amountCents === null || amountCents === undefined) {
        throw createError({ statusCode: 400, statusMessage: '该套餐不支持所选周期' });
    }
    if (amountCents <= 0) {
        throw createError({ statusCode: 400, statusMessage: '该套餐价格未配置，请联系管理员' });
    }

    const [order] = await db
        .insert(orders)
        .values({
            id: crypto.randomUUID(),
            orderNo: generateOrderNo(),
            userId: params.userId,
            planId: plan.id,
            planCode: plan.code,
            period: params.period,
            amountCents,
            provider: params.provider,
            status: 'pending',
        })
        .returning();
    if (!order) {
        throw createError({ statusCode: 500, statusMessage: '创建订单失败' });
    }
    return {
        order,
        plan: {
            id: plan.id,
            code: plan.code,
            name: plan.name,
            description: plan.description,
            chatQuotaPerDay: plan.chatQuotaPerDay,
            monthlyPriceCents: plan.monthlyPriceCents,
            yearlyPriceCents: plan.yearlyPriceCents,
            enabled: plan.enabled,
            sortOrder: plan.sortOrder,
        },
    };
}

/**
 * 支付成功 → 开通会员（幂等：订单已是 paid 直接返回）。
 * 续费从当前到期时间顺延；新购/过期从现在开始。
 * 并发安全：订单状态更新带 status='pending' 条件守卫，回调重试与前端轮询并发时只有一个事务生效。
 */
export async function activateMembership(orderNo: string, providerTradeNo?: string): Promise<typeof orders.$inferSelect> {
    const [order] = await db.select().from(orders).where(eq(orders.orderNo, orderNo));
    if (!order) throw createError({ statusCode: 404, statusMessage: '订单不存在' });
    if (order.status === 'paid') return order;
    if (order.status !== 'pending') throw createError({ statusCode: 400, statusMessage: `订单状态为 ${order.status}，不能开通` });

    const now = new Date();
    const updated = await db.transaction(async (tx) => {
        // 用户级事务锁：串行化同一用户的开通
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${order.userId}, 0))`);

        // 当前会员在锁内读取，保证续期基准一致
        const [current] = await tx
            .select()
            .from(userMemberships)
            .where(and(eq(userMemberships.userId, order.userId), gt(userMemberships.expiresAt, now)))
            .orderBy(desc(userMemberships.expiresAt))
            .limit(1);

        const base = current ? current.expiresAt : now;
        const expiresAt = addPeriod(base, order.period === 'yearly' ? 'yearly' : 'monthly');

        // 条件更新：0 行说明并发中已被处理，直接走幂等返回
        const [claimed] = await tx
            .update(orders)
            .set({ status: 'paid', paidAt: now, providerTradeNo: providerTradeNo ?? order.providerTradeNo, updatedAt: now })
            .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
            .returning();
        if (!claimed) return null;

        await tx.insert(userMemberships).values({
            id: crypto.randomUUID(),
            userId: order.userId,
            planId: order.planId,
            planCode: order.planCode,
            status: 'active',
            startsAt: now,
            expiresAt,
            orderId: order.id,
        });
        return claimed;
    });

    if (!updated) {
        const [paid] = await db.select().from(orders).where(eq(orders.orderNo, orderNo));
        if (!paid || paid.status !== 'paid') throw createError({ statusCode: 409, statusMessage: '订单状态冲突，请稍后重试' });
        return paid;
    }
    return updated;
}

/** 将过期会员标记为 expired（懒清理，查询时顺带执行即可） */
export async function expireStaleMemberships(userId: string): Promise<void> {
    await db
        .update(userMemberships)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(and(eq(userMemberships.userId, userId), eq(userMemberships.status, 'active'), sql`${userMemberships.expiresAt} <= now()`));
}

/**
 * 批处理关闭超时未支付的 pending 订单（默认 30 分钟）。
 *
 * 只关闭「渠道侧确认未支付 / 已关闭」的订单：
 * - 渠道查询为 SUCCESS 时说明用户其实已付款，此时补开通而不是关单；
 * - 渠道状态未知（null/UNKNOWN）或渠道拒绝关单时保持 pending，等回调或下次清理，
 *   避免把已付款订单本地置为 closed 后回调无法再开通会员。
 */
export async function closeStalePendingOrders(olderThanMinutes = 30): Promise<number> {
    const threshold = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const staleOrders = await db
        .select()
        .from(orders)
        .where(and(eq(orders.status, 'pending'), lt(orders.createdAt, threshold)))
        .limit(100);

    let count = 0;
    for (const ord of staleOrders) {
        let provider: ReturnType<typeof getPaymentProvider>;
        try {
            provider = getPaymentProvider(ord.provider);
        } catch {
            continue;
        }

        let remote: Awaited<ReturnType<typeof provider.queryOrder>> = null;
        try {
            remote = await provider.queryOrder(ord.orderNo);
        } catch {
            remote = null;
        }

        if (remote === 'SUCCESS') {
            await activateMembership(ord.orderNo);
            continue;
        }
        if (remote !== 'NOTPAY' && remote !== 'CLOSED') {
            // 渠道不可用 / 状态未知：不做本地关单
            continue;
        }

        let closed = false;
        try {
            closed = await provider.closeOrder(ord.orderNo);
        } catch {
            closed = false;
        }
        if (!closed) continue;

        await db.update(orders).set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, ord.id));
        count++;
    }
    return count;
}
