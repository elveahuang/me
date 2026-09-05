import { fetchSession } from '@/lib/session';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
    beforeLoad: async () => {
        const session = await fetchSession();
        if (session) throw redirect({ to: '/chat', search: {} });
        throw redirect({ to: '/login', search: {} });
    },
});
