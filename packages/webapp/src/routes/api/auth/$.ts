import { auth } from '@/lib/auth';
import { corsMiddleware } from '@/lib/cors';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/auth/$')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => auth.handler(request),
            POST: async ({ request }) => auth.handler(request),
        },
    },
});
