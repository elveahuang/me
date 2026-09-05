import { authClient } from '@/lib/auth-client';
import { fetchSession } from '@/lib/session';
import { Button } from '@heroui/react';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/register')({
    beforeLoad: async () => {
        const session = await fetchSession();
        if (session) throw redirect({ to: '/chat', search: {} });
    },
    component: RegisterPage,
});

function RegisterPage() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        const { error: signUpError } = await authClient.signUp.email({
            name: name || email.split('@')[0] || '用户',
            email,
            password,
        });
        setLoading(false);
        if (signUpError) {
            setError(signUpError.message ?? '注册失败，请稍后再试');
            return;
        }
        window.location.href = '/chat';
    };

    return (
        <div className='flex min-h-dvh items-center justify-center bg-gray-50 p-6'>
            <div className='w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm'>
                <h1 className='text-2xl font-bold text-gray-900'>注册</h1>
                <p className='mt-1 text-sm text-gray-500'>创建账号，开始与智能体对话。</p>
                <form className='mt-6 space-y-4' onSubmit={handleSubmit}>
                    <div>
                        <label className='mb-1 block text-sm font-medium text-gray-700' htmlFor='name'>
                            昵称
                        </label>
                        <input
                            id='name'
                            type='text'
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                            placeholder='可选'
                        />
                    </div>
                    <div>
                        <label className='mb-1 block text-sm font-medium text-gray-700' htmlFor='email'>
                            邮箱
                        </label>
                        <input
                            id='email'
                            type='email'
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                            placeholder='you@example.com'
                        />
                    </div>
                    <div>
                        <label className='mb-1 block text-sm font-medium text-gray-700' htmlFor='password'>
                            密码
                        </label>
                        <input
                            id='password'
                            type='password'
                            required
                            minLength={8}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                            placeholder='至少 8 位'
                        />
                    </div>
                    {error ? <p className='text-sm text-red-600'>{error}</p> : null}
                    <Button type='submit' fullWidth isDisabled={loading}>
                        {loading ? '注册中…' : '注册'}
                    </Button>
                </form>
                <p className='mt-4 text-center text-sm text-gray-500'>
                    已有账号？{' '}
                    <Link to='/login' className='font-medium text-blue-600 hover:underline'>
                        直接登录
                    </Link>
                </p>
            </div>
        </div>
    );
}
