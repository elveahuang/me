import { errorResponse, json, requireUser } from '@/lib/api';
import { listPlans } from '@/lib/billing';
import { corsMiddleware } from '@/lib/cors';
import { listPaymentProviders } from '@/lib/payments';
import { createFileRoute } from '@tanstack/react-router';

type RouteParams = { request: Request };

/** 会员套餐列表（用户侧，登录后可见） */
export const Route = createFileRoute('/api/plans')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }: RouteParams) => {
                try {
                    await requireUser(request);
                    const plans = await listPlans();
                    return json({ plans, providers: listPaymentProviders() });
                } catch (e) {
                    return errorResponse(e);
                }
            },
        },
    },
});
