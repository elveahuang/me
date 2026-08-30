import { createFileRoute } from '@tanstack/react-router';
import { corsMiddleware } from '@/lib/cors';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { conversations, messages } from '@schema';
import { errorResponse, HttpError, json, parseId, requireUser } from '@/lib/api';

type RouteParams = { request: Request; params: { id: string } };

/** 单个会话：读取完整消息 / 删除会话（仅限本人） */
export const Route = createFileRoute('/api/conversations/$id')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request, params }: RouteParams) => {
                try {
                    const session = await requireUser(request);
                    const id = parseId(params.id, '会话 ID');

                    const [conversation] = await db
                        .select()
                        .from(conversations)
                        .where(and(eq(conversations.id, id), eq(conversations.userId, session.user.id)));
                    if (!conversation) throw new HttpError(404, '会话不存在');

                    const list = await db
                        .select({ id: messages.id, role: messages.role, parts: messages.parts, createdAt: messages.createdAt })
                        .from(messages)
                        .where(eq(messages.conversationId, id))
                        .orderBy(asc(messages.seq));

                    return json({ conversation, messages: list });
                } catch (e) {
                    return errorResponse(e);
                }
            },
            DELETE: async ({ request, params }: RouteParams) => {
                try {
                    const session = await requireUser(request);
                    const id = parseId(params.id, '会话 ID');

                    const deleted = await db
                        .delete(conversations)
                        .where(and(eq(conversations.id, id), eq(conversations.userId, session.user.id)))
                        .returning({ id: conversations.id });
                    if (deleted.length === 0) throw new HttpError(404, '会话不存在');

                    return json({ ok: true });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
