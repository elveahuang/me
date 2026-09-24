import { eq } from 'drizzle-orm';
import { membershipPlans, orders, userMemberships } from '../../../db/schema';
import { invalidatePlansCache } from '../../../utils/billing';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

/**
 * 删除套餐（有订单或会员记录引用时禁止，需改为下架）。
 *
 * 读套餐、查引用、删除三步必须在同一事务里，且开头那步要 FOR UPDATE 锁住待删行：
 * `orders.plan_id` 与 `user_memberships.plan_id` 都是 `onDelete: 'restrict'`，而「查引用」与
 * 「删除」之间只要有一个用户下单成功，删除就撞外键（23503）变成 500（开发态还把 SQL 原文带进
 * stack），管理员看到的是「未知错误」而不是那句「请改为下架」。父行上的 FOR UPDATE 与并发
 * INSERT 的 FK 检查（FOR KEY SHARE）天然互斥，所以新引用要么在查引用之前就已提交并被查到
 * （于是这一次删除被拒），要么排到删除提交之后，不会两边都以为自己是安全的。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id');
    if (!id) throw createError({ statusCode: 400, statusMessage: '缺少套餐 ID' });

    await db.transaction(async (tx) => {
        const [plan] = await tx.select().from(membershipPlans).where(eq(membershipPlans.id, id)).for('update');
        if (!plan) throw createError({ statusCode: 404, statusMessage: '套餐不存在' });

        if (plan.code === 'free') {
            throw createError({ statusCode: 400, statusMessage: '免费套餐不可删除（可编辑或下架）' });
        }

        const referencedOrder = await tx.select({ id: orders.id }).from(orders).where(eq(orders.planId, id)).limit(1);
        const referencedMembership = await tx.select({ id: userMemberships.id }).from(userMemberships).where(eq(userMemberships.planId, id)).limit(1);
        if (referencedOrder.length || referencedMembership.length) {
            throw createError({ statusCode: 400, statusMessage: '该套餐已有订单或会员记录，请改为下架（enabled=false）' });
        }

        await tx.delete(membershipPlans).where(eq(membershipPlans.id, id));
    });

    await invalidatePlansCache();
    return { ok: true };
});
