import { AuthView } from '@daveyplate/better-auth-ui';
import { authViewPaths } from '@daveyplate/better-auth-ui/server';
import { JSX } from 'react';

export const dynamicParams = false;

export function generateStaticParams(): { path: string }[] {
    return Object.values(authViewPaths).map((path: string): { path: string } => ({ path }));
}

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }): Promise<JSX.Element> {
    const { path } = await params;
    return (
        <main className='container flex grow flex-col items-center justify-center self-center'>
            <AuthView path={path} />
        </main>
    );
}
