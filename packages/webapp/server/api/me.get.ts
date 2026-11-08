import type { MeResponse } from '@commons/contract';
import { eq, sql } from 'drizzle-orm';
import { conversations } from '../db/schema';
import { getMembershipStatus } from '../utils/billing';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

/**
 * 获取当前登录用户画像、统计指标与会员权益状态。
 *
 * 返回值 satisfies 契约类型（import type 在编译期擦除，不触碰「server 不 import 共享契约」的
 * 运行时边界）：服务端改响应字段而忘记同步契约时，这里直接编译报错，而不是等两端页面对不上。
 */
export default defineEventHandler(async (event): Promise<MeResponse> => {
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
        // better-auth 的 session.user 带 createdAt/banExpires 等 Date 字段且 role 可选，
        // 按 contract 字段显式挑选：序列化到线上的形状在这里定死，而不是靠结构兼容碰运气。
        user: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            emailVerified: session.user.emailVerified,
            image: session.user.image,
            role: session.user.role ?? 'user',
            banned: session.user.banned,
        },
        stats: {
            totalConversations: convStat?.count ?? 0,
        },
        membership,
    };
});
