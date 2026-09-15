import { eq, sql } from 'drizzle-orm';
import { conversations } from '../db/schema';
import { getMembershipStatus } from '../utils/billing';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

/** 获取当前登录用户画像、统计指标与会员权益状态 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);

    const [convStat] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversations)
        .where(eq(conversations.userId, session.user.id));

    const membership = await getMembershipStatus(session.user.id);

    return {
        user: session.user,
        stats: {
            totalConversations: convStat?.count ?? 0,
        },
        membership,
    };
});
