import { eq } from 'drizzle-orm';
import { membershipPlans, orders, userMemberships } from '../../../db/schema';
import { invalidatePlansCache } from '../../../utils/billing';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

/** 删除套餐（有订单引用时禁止删除，需改为下架） */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id');
    if (!id) throw createError({ statusCode: 400, statusMessage: '缺少套餐 ID' });

    const [plan] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, id));
    if (!plan) throw createError({ statusCode: 404, statusMessage: '套餐不存在' });

    if (plan.code === 'free') {
        throw createError({ statusCode: 400, statusMessage: '免费套餐不可删除（可编辑或下架）' });
    }

    const [referencedOrder, referencedMembership] = await Promise.all([
        db.select({ id: orders.id }).from(orders).where(eq(orders.planId, id)).limit(1),
        db.select({ id: userMemberships.id }).from(userMemberships).where(eq(userMemberships.planId, id)).limit(1),
    ]);
    if (referencedOrder.length || referencedMembership.length) {
        throw createError({ statusCode: 400, statusMessage: '该套餐已有订单或会员记录，请改为下架（enabled=false）' });
    }

    const deleted = await db.delete(membershipPlans).where(eq(membershipPlans.id, id)).returning({ id: membershipPlans.id });
    if (deleted.length === 0) {
        throw createError({ statusCode: 404, statusMessage: '套餐不存在' });
    }

    await invalidatePlansCache();
    return { ok: true };
});
