import { authClient } from '@/lib/auth-client';
import { isAdminRole } from '@/lib/session';
import { Button } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

export interface SessionUser {
    id: string;
    name: string;
    email: string;
    role: string;
}

export function AppHeader({ user }: { user: SessionUser }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const handleSignOut = async () => {
        await authClient.signOut();
        queryClient.clear();
        navigate({ to: '/login' });
    };

    return (
        <header className='flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4'>
            <div className='flex items-center gap-4'>
                <Link to='/chat' search={{}} className='text-lg font-bold'>
                    🤖 AI Agent
                </Link>
                <nav className='flex items-center gap-1 text-sm'>
                    <Link
                        to='/chat'
                        search={{}}
                        className='rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                        activeProps={{ className: 'bg-gray-100 text-gray-900 font-medium' }}
                    >
                        对话
                    </Link>
                    {isAdminRole(user.role) ? (
                        <Link
                            to='/admin'
                            search={{}}
                            className='rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                            activeProps={{ className: 'bg-gray-100 text-gray-900 font-medium' }}
                        >
                            管理
                        </Link>
                    ) : null}
                </nav>
            </div>
            <div className='flex items-center gap-3 text-sm'>
                <span className='hidden text-gray-600 sm:inline'>{user.email}</span>
                <Button size='sm' variant='ghost' onPress={handleSignOut}>
                    退出登录
                </Button>
            </div>
        </header>
    );
}
