import { Providers } from '@/core/components/providers';
import '@/core/styles/globals.css';
import clsx from 'clsx';
import { Metadata } from 'next';
import React, { JSX } from 'react';

export const metadata: Metadata = {
    title: 'ME',
    description: 'ME Webapp',
};

export default async function RootLayout({ children }: { children: React.ReactNode }): Promise<JSX.Element> {
    return (
        <html suppressHydrationWarning lang='en'>
            <head>
                <meta charSet='UTF-8' />
                <meta name='viewport' content='width=device-width, initial-scale=1.0' />
                <title>App</title>
            </head>
            <body className={clsx('text-foreground bg-background min-h-screen font-sans antialiased')}>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
