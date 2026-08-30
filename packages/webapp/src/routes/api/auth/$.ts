import { createFileRoute } from '@tanstack/react-router';
import { corsMiddleware } from '@/lib/cors';
import { auth } from '@/lib/auth';

export const Route = createFileRoute('/api/auth/$')({
    server: {
        middleware: [corsMiddleware],
        handlers: {
            GET: async ({ request }) => auth.handler(request),
            POST: async ({ request }) => auth.handler(request),
        },
    },
});
