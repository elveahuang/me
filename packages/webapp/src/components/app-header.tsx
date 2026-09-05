import { authClient } from '@/lib/auth-client';
import { api } from '@/lib/client-api';
import { isAdminRole } from '@/lib/session';
import { Button } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export interface SessionUser {
    id: string;
    name: string;
    email: string;
    role: string;
}

interface MembershipSummary {
    plan: { id: number; name: string } | null;
    chatQuotaPerDay: number | null;
    usedToday: number;
}

const navLinkClass = 'rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900';
const navLinkActive = { className: 'bg-gray-100 text-gray-900 font-medium' };

export function AppHeader({ user }: { user: SessionUser }) {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const { data: membership } = useQuery({
        queryKey: ['billing', 'membership'],
        queryFn: () => api<MembershipSummary>('/api/billing/membership'),
    });

    const handleSignOut = async () => {
        await authClient.signOut();
        queryClient.clear();
        navigate({ to: '/login' });
    };

    const currentLang = i18n.language?.startsWith('zh') ? 'zh' : 'en';

    const toggleLanguage = () => {
        const next = currentLang === 'zh' ? 'en' : 'zh';
        void i18n.changeLanguage(next);
        localStorage.setItem('app_lang', next);
        window.location.reload();
    };

    return (
        <header className='flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4'>
            <div className='flex items-center gap-4'>
                <Link to='/chat' search={{}} className='text-lg font-bold'>
                    {t('nav.brand')}
                </Link>
                <nav className='flex items-center gap-1 text-sm'>
                    <Link to='/chat' search={{}} className={navLinkClass} activeProps={navLinkActive}>
                        {t('nav.chat')}
                    </Link>
                    <Link to='/pricing' search={{}} className={navLinkClass} activeProps={navLinkActive}>
                        {t('nav.pricing')}
                    </Link>
                    {isAdminRole(user.role) ? (
                        <Link to='/admin' search={{}} className={navLinkClass} activeProps={navLinkActive}>
                            {t('nav.admin')}
                        </Link>
                    ) : null}
                </nav>
            </div>
            <div className='flex items-center gap-3 text-sm'>
                {membership?.plan ? (
                    <Link
                        to='/pricing'
                        search={{}}
                        className='hidden items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700 hover:bg-blue-100 sm:flex'
                    >
                        <span className='font-medium'>{membership.plan.name}</span>
                        <span className='rounded-full bg-white px-2 py-0.5 text-blue-600'>
                            {membership.usedToday}/{membership.chatQuotaPerDay ?? '∞'}
                        </span>
                    </Link>
                ) : null}
                <span className='hidden text-gray-600 sm:inline'>{user.email}</span>
                <Button size='sm' variant='ghost' onPress={toggleLanguage}>
                    {currentLang === 'zh' ? 'EN' : '中文'}
                </Button>
                <Button size='sm' variant='ghost' onPress={handleSignOut}>
                    {t('common.logout')}
                </Button>
            </div>
        </header>
    );
}
