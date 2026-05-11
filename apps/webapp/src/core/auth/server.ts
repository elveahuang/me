import { auth } from '@/core/auth';
import { headers } from 'next/headers';

const someAuthenticatedAction = async () => {
    'use server';
    const session = await auth.api.getSession({
        headers: await headers(),
    });
};
