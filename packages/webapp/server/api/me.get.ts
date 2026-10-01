import { eq, sql } from 'drizzle-orm';
import { conversations } from '../db/schema';
import { getMembershipStatus } from '../utils/billing';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

/** 获取当前登录用户画像、统计指标与会员权益状态 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);

    // 会话计数与会员状态查询互不依赖，并发发出。
    const [[convStat], membership] = await Promise.all([
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(conversations)
            .where(eq(conversations.userId, session.user.id)),
        getMembershipStatus(session.user.id),
    ]);

    return {
        user: session.user,
        stats: {
            totalConversations: convStat?.count ?? 0,
        },
        membership,
    };
});
