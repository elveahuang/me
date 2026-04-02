import { Providers } from '@/core/components/providers';
import '@/core/styles/globals.css';
import config from '@payload-config';
import clsx from 'clsx';
import { Metadata } from 'next';
import { getPayload } from 'payload';
import React, { JSX, StrictMode } from 'react';
import { Toaster } from 'sonner';
import { AppNavbar } from './components/AppNavbar';

export const metadata: Metadata = {
    title: 'ME 3',
    description: 'ME Webapp',
};

export default async function RootLayout({ children }: { children: React.ReactNode }): Promise<JSX.Element> {
    const payload = await getPayload({ config });
    const headerData = await payload.findGlobal({ slug: 'header', depth: 1 }).catch(() => null);

    return (
        <html lang='en' suppressHydrationWarning>
            <head>
                <meta charSet='UTF-8' />
                <meta name='viewport' content='width=device-width, initial-scale=1.0' />
                <title>ME</title>
            </head>
            <body className={clsx('text-foreground bg-background text-medium min-h-screen font-sans antialiased')}>
                <StrictMode>
                    <Providers>
                        <AppNavbar siteName='ME CMS' navItems={headerData?.navItems} />
                        <main className='relative flex min-h-[calc(100vh-64px)] w-full flex-col'>{children}</main>
                    </Providers>
                    <Toaster />
                </StrictMode>
            </body>
        </html>
    );
}
