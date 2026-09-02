import appCss from '@/commons/styles/theme.css?url';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import React from 'react';
import { queryClient } from '@/lib/query';

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
                title: 'AI Agent 平台',
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
    return (
        <div className='flex min-h-dvh flex-col items-center justify-center gap-3 bg-gray-50'>
            <div className='text-6xl'>🤖</div>
            <p className='text-lg font-semibold text-gray-900'>页面不存在</p>
            <a href='/' className='text-sm text-blue-600 hover:underline'>
                返回首页
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
