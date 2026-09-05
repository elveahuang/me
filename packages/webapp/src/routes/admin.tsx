import type { SessionUser } from '@/components/app-header';
import { AppHeader } from '@/components/app-header';
import { fetchSession, isAdminRole } from '@/lib/session';
import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

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
    const { t } = useTranslation();
    const { session } = Route.useRouteContext();
    const user = session.user as SessionUser;

    return (
        <div className='flex h-dvh flex-col'>
            <AppHeader user={user} />
            <div className='flex min-h-0 flex-1'>
                <aside className='w-56 shrink-0 border-r border-gray-200 bg-white p-3'>
                    <nav className='space-y-1 text-sm'>
                        {[
                            { to: '/admin', label: t('admin.nav.overview'), exact: true },
                            { to: '/admin/agents', label: t('admin.nav.agents') },
                            { to: '/admin/skills', label: t('admin.nav.skills') },
                            { to: '/admin/tools', label: t('admin.nav.tools') },
                            { to: '/admin/mcp', label: t('admin.nav.mcp') },
                            { to: '/admin/knowledge', label: t('admin.nav.knowledge') },
                            { to: '/admin/providers', label: t('admin.nav.providers') },
                            { to: '/admin/plans', label: t('admin.nav.plans') },
                            { to: '/admin/orders', label: t('admin.nav.orders') },
                            { to: '/admin/users', label: t('admin.nav.users') },
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
