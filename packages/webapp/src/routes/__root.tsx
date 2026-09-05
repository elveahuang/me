// i18n 初始化必须在应用渲染前生效（模块副作用）
import '@/i18n';
import i18n from '@/i18n';
import appCss from '@/commons/styles/theme.css?url';
import { queryClient } from '@/lib/query';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

export interface MyRouterContext {
    queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
    head: () => ({
        meta: [
            {
                charSet: 'utf-8',
            },
            {
                name: 'viewport',
                content: 'width=device-width, initial-scale=1',
            },
            {
                title: i18n.t('app.title'),
            },
        ],
        links: [
            {
                rel: 'stylesheet',
                href: appCss,
            },
        ],
    }),
    shellComponent: RootDocument,
    notFoundComponent: NotFound,
    component: () => <Outlet />,
});

function NotFound() {
    const { t } = useTranslation();
    return (
        <div className='flex min-h-dvh flex-col items-center justify-center gap-3 bg-gray-50'>
            <div className='text-6xl'>🤖</div>
            <p className='text-lg font-semibold text-gray-900'>{t('notFound.title')}</p>
            <a href='/' className='text-sm text-blue-600 hover:underline'>
                {t('notFound.backHome')}
            </a>
        </div>
    );
}

function RootDocument({ children }: { children: React.ReactNode }) {
    return (
        <html lang='zh-CN'>
            <head>
                <HeadContent />
            </head>
            <body>
                <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
                <Scripts />
            </body>
        </html>
    );
}
