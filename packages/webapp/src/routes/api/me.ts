import { createFileRoute } from '@tanstack/react-router';
import { corsMiddleware } from '@/lib/cors';
import { errorResponse, json, requireUser } from '@/lib/api';

/** 当前登录用户信息（供 webapp / mobile 判断登录态） */
export const Route = createFileRoute('/api/me')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => {
                try {
                    const session = await requireUser(request);
                    return json({
                        user: {
                            id: session.user.id,
                            name: session.user.name,
                            email: session.user.email,
                            role: session.user.role,
                            image: session.user.image,
                        },
                    });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
