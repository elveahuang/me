import { errorResponse, json, requireUser } from '@/lib/api';
import { expireStaleMemberships, getMembershipStatus } from '@/lib/billing';
import { corsMiddleware } from '@/lib/cors';
import { createFileRoute } from '@tanstack/react-router';

type RouteParams = { request: Request };

/** 当前用户会员状态（套餐、到期时间、当日配额与用量） */
export const Route = createFileRoute('/api/billing/membership')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }: RouteParams) => {
                try {
                    const session = await requireUser(request);
                    await expireStaleMemberships(session.user.id);
                    const status = await getMembershipStatus(session.user.id);
                    return json(status);
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
