import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { AppHeader } from '@/components/app-header';
import type { SessionUser } from '@/components/app-header';
import { fetchSession, isAdminRole } from '@/lib/session';

export const Route = createFileRoute('/admin')({
    beforeLoad: async () => {
        const session = await fetchSession();
        if (!session) throw redirect({ to: '/login', search: {} });
        if (!isAdminRole(session.user.role)) throw redirect({ to: '/chat', search: {} });
        return { session };
    },
    component: AdminLayout,
});

function AdminLayout() {
    const { session } = Route.useRouteContext();
    const user = session.user as SessionUser;

    return (
        <div className='flex h-dvh flex-col'>
            <AppHeader user={user} />
            <div className='flex min-h-0 flex-1'>
                <aside className='w-56 shrink-0 border-r border-gray-200 bg-white p-3'>
                    <nav className='space-y-1 text-sm'>
                        {[
                            { to: '/admin', label: '📊 数据总览', exact: true },
                            { to: '/admin/agents', label: '🤖 智能体' },
                            { to: '/admin/skills', label: '🧩 Skills' },
                            { to: '/admin/users', label: '👥 用户' },
                        ].map((item) => (
                            <Link
                                key={item.to}
                                to={item.to}
                                className='block rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-100'
                                activeOptions={{ exact: item.exact === true }}
                                activeProps={{ className: 'bg-blue-50 text-blue-700 font-medium' }}
                            >
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </aside>
                <main className='min-w-0 flex-1 overflow-y-auto bg-gray-50 p-6'>
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
