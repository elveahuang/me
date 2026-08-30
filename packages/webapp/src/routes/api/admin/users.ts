import { createFileRoute } from '@tanstack/react-router';
import { corsMiddleware } from '@/lib/cors';
import { asc, count, eq } from 'drizzle-orm';
import { db } from '@/db';
import { conversations, user } from '@schema';
import { errorResponse, json, requireAdmin } from '@/lib/api';

/** 用户列表（带会话数） */
export const Route = createFileRoute('/api/admin/users')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireAdmin(request);
                    const list = await db
                        .select({
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            role: user.role,
                            banned: user.banned,
                            banReason: user.banReason,
                            createdAt: user.createdAt,
                            conversationCount: count(conversations.id),
                        })
                        .from(user)
                        .leftJoin(conversations, eq(conversations.userId, user.id))
                        .groupBy(user.id)
                        .orderBy(asc(user.createdAt));
                    return json(list.map((u) => ({ ...u, conversationCount: Number(u.conversationCount) })));
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
