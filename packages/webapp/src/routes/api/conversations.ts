import { createFileRoute } from '@tanstack/react-router';
import { corsMiddleware } from '@/lib/cors';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { agents, conversations } from '@schema';
import { errorResponse, HttpError, json, readJson, requireUser } from '@/lib/api';

const CreateBodySchema = z.object({
    agentId: z.number().int().positive(),
    title: z.string().max(60).optional(),
});

/** 当前用户的会话列表 */
export const Route = createFileRoute('/api/conversations')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    const session = await requireUser(request);
                    const list = await db
                        .select({
                            id: conversations.id,
                            title: conversations.title,
                            agentId: conversations.agentId,
                            agentName: agents.name,
                            agentEmoji: agents.emoji,
                            updatedAt: conversations.updatedAt,
                        })
                        .from(conversations)
                        .innerJoin(agents, eq(conversations.agentId, agents.id))
                        .where(eq(conversations.userId, session.user.id))
                        .orderBy(desc(conversations.updatedAt));
                    return json(list);
                } catch (e) {
                    return errorResponse(e);
                }
            },
            POST: async ({ request }) => {
                try {
                    const session = await requireUser(request);
                    const body = CreateBodySchema.safeParse(await readJson<unknown>(request));
                    if (!body.success) throw new HttpError(400, '请求参数错误');

                    const [agent] = await db
                        .select({ id: agents.id })
                        .from(agents)
                        .where(and(eq(agents.id, body.data.agentId), eq(agents.enabled, true)));
                    if (!agent) throw new HttpError(404, '智能体不存在或未启用');

                    const [conversation] = await db
                        .insert(conversations)
                        .values({
                            userId: session.user.id,
                            agentId: agent.id,
                            title: body.data.title ?? '新对话',
                        })
                        .returning();

                    return json(conversation, 201);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
