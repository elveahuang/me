import { authClient } from '@/lib/auth-client';
import { fetchSession } from '@/lib/session';
import { Button } from '@heroui/react';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/login')({
    beforeLoad: async () => {
        const session = await fetchSession();
        if (session) throw redirect({ to: '/chat', search: {} });
    },
    component: LoginPage,
});

function LoginPage() {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [wechatEnabled, setWechatEnabled] = useState(false);

    // 微信公众号登录是否可用（服务端配置了凭据才显示入口）
    useEffect(() => {
        fetch('/api/auth/wechat/status')
            .then((r) => r.json())
            .then((d: { enabled?: boolean }) => setWechatEnabled(Boolean(d.enabled)))
            .catch(() => setWechatEnabled(false));
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        const { error: signInError } = await authClient.signIn.email({ email, password });
        setLoading(false);
        if (signInError) {
            setError(signInError.message ?? t('login.errorFallback'));
            return;
        }
        window.location.href = '/chat';
    };

    return (
        <div className='flex min-h-dvh items-center justify-center bg-gray-50 p-6'>
            <div className='w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm'>
                <h1 className='text-2xl font-bold text-gray-900'>{t('login.title')}</h1>
                <p className='mt-1 text-sm text-gray-500'>{t('login.subtitle')}</p>
                <form className='mt-6 space-y-4' onSubmit={handleSubmit}>
                    <div>
                        <label className='mb-1 block text-sm font-medium text-gray-700' htmlFor='email'>
                            {t('login.email')}
                        </label>
                        <input
                            id='email'
                            type='email'
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                            placeholder={t('login.emailPlaceholder')}
                        />
                    </div>
                    <div>
                        <label className='mb-1 block text-sm font-medium text-gray-700' htmlFor='password'>
                            {t('login.password')}
                        </label>
                        <input
                            id='password'
                            type='password'
                            required
                            minLength={8}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                            placeholder={t('login.passwordPlaceholder')}
                        />
                    </div>
                    {error ? <p className='text-sm text-red-600'>{error}</p> : null}
                    <Button type='submit' fullWidth isDisabled={loading}>
                        {loading ? t('login.submitting') : t('login.submit')}
                    </Button>
                </form>
                {wechatEnabled ? (
                    <a
                        href='/api/auth/wechat?redirect=/chat'
                        className='mt-3 block w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-50'
                    >
                        {t('login.wechat')}
                    </a>
                ) : null}
                <p className='mt-4 text-center text-sm text-gray-500'>
                    {t('login.noAccount')}{' '}
                    <Link to='/register' className='font-medium text-blue-600 hover:underline'>
                        {t('login.goRegister')}
                    </Link>
                </p>
            </div>
        </div>
    );
}
