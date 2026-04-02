'use client';

import { authClient } from '@/core/auth/client.ts';
import { IntlProvider } from '@/core/i18n';
import { AuthUIProvider } from '@daveyplate/better-auth-ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { JSX, PropsWithChildren } from 'react';

export interface ProvidersProps {
    children: React.ReactNode;
    theme?: PropsWithChildren;
}

export function Providers({ children }: ProvidersProps): JSX.Element {
    const router = useRouter();
    return (
        <IntlProvider>
            <AuthUIProvider
                authClient={authClient}
                navigate={router.push}
                replace={router.replace}
                onSessionChange={(): void => {
                    router.refresh();
                }}
                Link={Link}
            >
                {children}
            </AuthUIProvider>
        </IntlProvider>
    );
}
