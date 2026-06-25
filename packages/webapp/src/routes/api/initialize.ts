import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/initialize')({
    server: {
        handlers: {
            POST: async ({ request }): Promise<Response> => {
                console.info('GET /api/users @', request.url);
                return Response.json({
                    msg: 'Hello World',
                });
            },
        },
    },
});
