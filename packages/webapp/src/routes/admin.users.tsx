import { api } from '@/lib/client-api';
import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

interface AdminUser {
    id: string;
    name: string;
    email: string;
    role: string;
    banned: boolean | null;
    banReason: string | null;
    createdAt: string;
    conversationCount: number;
}

export const Route = createFileRoute('/admin/users')({
    component: AdminUsersPage,
});

function AdminUsersPage() {
    const queryClient = useQueryClient();
    const { data: users = [], isLoading } = useQuery({
        queryKey: ['admin', 'users'],
        queryFn: () => api<AdminUser[]>('/api/admin/users'),
    });
    const [message, setMessage] = useState<string | null>(null);

    const patchMutation = useMutation({
        mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
            api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
        onError: (e) => setMessage(e instanceof Error ? e.message : '操作失败'),
    });

    return (
        <div className='space-y-4'>
            <div>
                <h1 className='text-xl font-bold text-gray-900'>用户管理</h1>
                <p className='mt-1 text-sm text-gray-500'>设置管理员角色、封禁/解封账号。不能操作自己的账号。</p>
            </div>
            {message ? <p className='text-sm text-red-600'>{message}</p> : null}

            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
                <table className='w-full text-sm'>
                    <thead className='bg-gray-50 text-left text-xs text-gray-500 uppercase'>
                        <tr>
                            <th className='px-4 py-3'>用户</th>
                            <th className='px-4 py-3'>角色</th>
                            <th className='px-4 py-3'>会话数</th>
                            <th className='px-4 py-3'>注册时间</th>
                            <th className='px-4 py-3'>状态</th>
                            <th className='px-4 py-3 text-right'>操作</th>
                        </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-100'>
                        {users.map((u) => (
                            <tr key={u.id} className={u.banned ? 'opacity-60' : undefined}>
                                <td className='px-4 py-3'>
                                    <div className='font-medium text-gray-900'>{u.name}</div>
                                    <div className='text-xs text-gray-400'>{u.email}</div>
                                </td>
                                <td className='px-4 py-3'>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs ${
                                            u.role.includes('admin') ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                                        }`}
                                    >
                                        {u.role.includes('admin') ? '管理员' : '用户'}
                                    </span>
                                </td>
                                <td className='px-4 py-3 text-gray-600 tabular-nums'>{u.conversationCount}</td>
                                <td className='px-4 py-3 text-xs text-gray-500'>{new Date(u.createdAt).toLocaleDateString()}</td>
                                <td className='px-4 py-3'>
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs ${u.banned ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
                                    >
                                        {u.banned ? `已封禁${u.banReason ? `（${u.banReason}）` : ''}` : '正常'}
                                    </span>
                                </td>
                                <td className='space-x-1 px-4 py-3 text-right whitespace-nowrap'>
                                    <Button
                                        size='sm'
                                        variant='ghost'
                                        onPress={() => patchMutation.mutate({ id: u.id, body: { role: u.role.includes('admin') ? 'user' : 'admin' } })}
                                    >
                                        {u.role.includes('admin') ? '降为用户' : '设为管理员'}
                                    </Button>
                                    <Button
                                        size='sm'
                                        variant='ghost'
                                        className={u.banned ? 'text-emerald-600' : 'text-red-500'}
                                        onPress={() =>
                                            patchMutation.mutate({
                                                id: u.id,
                                                body: u.banned ? { banned: false } : { banned: true, banReason: '违规使用' },
                                            })
                                        }
                                    >
                                        {u.banned ? '解封' : '封禁'}
                                    </Button>
                                </td>
                            </tr>
                        ))}
                        {!isLoading && users.length === 0 ? (
                            <tr>
                                <td colSpan={6} className='px-4 py-8 text-center text-gray-400'>
                                    暂无用户
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
