import { desc, eq } from 'drizzle-orm';
import { orders } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';

/** 我的订单列表（最近 50 条） */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const list = await db.select().from(orders).where(eq(orders.userId, session.user.id)).orderBy(desc(orders.createdAt)).limit(50);
    return { orders: list };
});
