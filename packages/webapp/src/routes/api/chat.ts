import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/chat')({
    server: {
        handlers: {
            POST: async ({ request }) => {
                console.info('GET /api/users @', request.url);
                return Response.json({
                    msg: 'Hello World',
                });
            },
        },
    },
});
