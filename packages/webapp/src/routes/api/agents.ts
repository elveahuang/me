import { db } from '@/db';
import { errorResponse, json, requireUser } from '@/lib/api';
import { corsMiddleware } from '@/lib/cors';
import { agents } from '@schema';
import { createFileRoute } from '@tanstack/react-router';
import { asc, eq } from 'drizzle-orm';

/** 已启用的智能体列表（登录用户可见） */
export const Route = createFileRoute('/api/agents')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    await requireUser(request);
                    const list = await db
                        .select({
                            id: agents.id,
                            name: agents.name,
                            emoji: agents.emoji,
                            description: agents.description,
                            model: agents.model,
                        })
                        .from(agents)
                        .where(eq(agents.enabled, true))
                        .orderBy(asc(agents.id));
                    return json(list);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
