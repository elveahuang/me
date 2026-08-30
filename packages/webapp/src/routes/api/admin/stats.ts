import { createFileRoute } from '@tanstack/react-router';
import { corsMiddleware } from '@/lib/cors';
import { count, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { agents, conversations, messages, skills, user } from '@schema';
import { errorResponse, json, requireAdmin } from '@/lib/api';

/** 管理端仪表盘统计 */
export const Route = createFileRoute('/api/admin/stats')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireAdmin(request);

                    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    const [[usersCount], [agentsCount], [skillsCount], [conversationsCount], [messagesCount], [activeConversations]] =
                        await Promise.all([
                            db.select({ value: count() }).from(user),
                            db.select({ value: count() }).from(agents),
                            db.select({ value: count() }).from(skills),
                            db.select({ value: count() }).from(conversations),
                            db.select({ value: count() }).from(messages),
                            db
                                .select({ value: count() })
                                .from(conversations)
                                .where(gte(conversations.updatedAt, dayAgo)),
                        ]);

                    const recentUsers = await db
                        .select({ id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt })
                        .from(user)
                        .orderBy(desc(user.createdAt))
                        .limit(5);

                    const modelUsage = await db
                        .select({ model: agents.model, value: count(conversations.id) })
                        .from(conversations)
                        .innerJoin(agents, eq(conversations.agentId, agents.id))
                        .groupBy(agents.model)
                        .orderBy(desc(count(conversations.id)));

                    return json({
                        totals: {
                            users: usersCount?.value ?? 0,
                            agents: agentsCount?.value ?? 0,
                            skills: skillsCount?.value ?? 0,
                            conversations: conversationsCount?.value ?? 0,
                            messages: messagesCount?.value ?? 0,
                            activeConversations24h: activeConversations?.value ?? 0,
                        },
                        recentUsers,
                        modelUsage: modelUsage.map((row) => ({ model: row.model, conversations: Number(row.value) })),
                        generatedAt: new Date().toISOString(),
                    });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
