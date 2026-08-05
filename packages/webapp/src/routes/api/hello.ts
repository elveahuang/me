import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

const getHello = createServerFn({ method: 'GET' }).handler(async () => {
    return {
        message: 'Hello from TanStack Start',
        framework: 'React',
        database: 'PostgreSQL',
    };
});

export const Route = createFileRoute('/api/hello')({
    loader: () => getHello(),
});
