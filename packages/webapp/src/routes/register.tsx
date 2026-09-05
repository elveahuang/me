import { authClient } from '@/lib/auth-client';
import { fetchSession } from '@/lib/session';
import { Button } from '@heroui/react';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/register')({
    beforeLoad: async () => {
        const session = await fetchSession();
        if (session) throw redirect({ to: '/chat', search: {} });
    },
    component: RegisterPage,
});

function RegisterPage() {
    const { t } = useTranslation();
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
            name: name || email.split('@')[0] || t('register.defaultName'),
            email,
            password,
        });
        setLoading(false);
        if (signUpError) {
            setError(signUpError.message ?? t('register.errorFallback'));
            return;
        }
        window.location.href = '/chat';
    };

    return (
        <div className='flex min-h-dvh items-center justify-center bg-gray-50 p-6'>
            <div className='w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm'>
                <h1 className='text-2xl font-bold text-gray-900'>{t('register.title')}</h1>
                <p className='mt-1 text-sm text-gray-500'>{t('register.subtitle')}</p>
                <form className='mt-6 space-y-4' onSubmit={handleSubmit}>
                    <div>
                        <label className='mb-1 block text-sm font-medium text-gray-700' htmlFor='name'>
                            {t('register.name')}
                        </label>
                        <input
                            id='name'
                            type='text'
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                            placeholder={t('register.namePlaceholder')}
                        />
                    </div>
                    <div>
                        <label className='mb-1 block text-sm font-medium text-gray-700' htmlFor='email'>
                            {t('register.email')}
                        </label>
                        <input
                            id='email'
                            type='email'
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                            placeholder={t('register.emailPlaceholder')}
                        />
                    </div>
                    <div>
                        <label className='mb-1 block text-sm font-medium text-gray-700' htmlFor='password'>
                            {t('register.password')}
                        </label>
                        <input
                            id='password'
                            type='password'
                            required
                            minLength={8}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                            placeholder={t('register.passwordPlaceholder')}
                        />
                    </div>
                    {error ? <p className='text-sm text-red-600'>{error}</p> : null}
                    <Button type='submit' fullWidth isDisabled={loading}>
                        {loading ? t('register.submitting') : t('register.submit')}
                    </Button>
                </form>
                <p className='mt-4 text-center text-sm text-gray-500'>
                    {t('register.hasAccount')}{' '}
                    <Link to='/login' className='font-medium text-blue-600 hover:underline'>
                        {t('register.goLogin')}
                    </Link>
                </p>
            </div>
        </div>
    );
}
