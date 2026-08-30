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
    component: () => <Outlet />,
});

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
