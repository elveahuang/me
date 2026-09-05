import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { queryClient } from './lib/query';
import { routeTree } from './routeTree.gen';

export function createRouter() {
    return createTanStackRouter({
        routeTree,
        context: { queryClient },
        scrollRestoration: true,
    });
}

export function getRouter() {
    return createRouter();
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof createRouter>;
    }
}
