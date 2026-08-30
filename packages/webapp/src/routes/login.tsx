import { Button } from '@heroui/react';
import { createFileRoute, redirect, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { fetchSession } from '@/lib/session';

export const Route = createFileRoute('/login')({
    beforeLoad: async () => {
        const session = await fetchSession();
        if (session) throw redirect({ to: '/chat', search: {} });
    },
    component: LoginPage,
});

function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        const { error: signInError } = await authClient.signIn.email({ email, password });
        setLoading(false);
        if (signInError) {
            setError(signInError.message ?? '登录失败，请检查邮箱和密码');
            return;
        }
        window.location.href = '/chat';
    };

    return (
        <div className='flex min-h-dvh items-center justify-center bg-gray-50 p-6'>
            <div className='w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm'>
                <h1 className='text-2xl font-bold text-gray-900'>登录</h1>
                <p className='mt-1 text-sm text-gray-500'>与智能体对话，从这里开始。</p>
                <form className='mt-6 space-y-4' onSubmit={handleSubmit}>
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
                        {loading ? '登录中…' : '登录'}
                    </Button>
                </form>
                <p className='mt-4 text-center text-sm text-gray-500'>
                    还没有账号？{' '}
                    <Link to='/register' className='font-medium text-blue-600 hover:underline'>
                        立即注册
                    </Link>
                </p>
            </div>
        </div>
    );
}
