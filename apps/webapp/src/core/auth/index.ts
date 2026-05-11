import * as schema from '@/core/auth/schema';
import { db } from '@/core/db';
import { Auth, betterAuth, BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { admin, bearer, jwt, username } from 'better-auth/plugins';

const authOptions: BetterAuthOptions = {
    secret: process.env.PAYLOAD_SECRET || '',
    database: drizzleAdapter(db, {
        provider: 'pg',
        camelCase: false,
        schema,
    }),
    emailAndPassword: {
        enabled: true,
    },
    emailVerification: {
        sendOnSignUp: true,
    },
    plugins: [
        admin(),
        bearer(),
        jwt(),
        nextCookies(),
        username({
            minUsernameLength: 6,
            maxUsernameLength: 50,
        }),
    ],
    advanced: {
        database: {
            generateId: 'uuid',
        },
        disableCSRFCheck: true,
    },
    user: {
        modelName: 'users',
    },
    session: {
        modelName: 'sessions',
    },
    account: {
        modelName: 'accounts',
    },
    verification: {
        modelName: 'verifications',
    },
};

export type BetterAuth = typeof authOptions;

export const auth: Auth<BetterAuth> = betterAuth({
    ...authOptions,
    plugins: [...(authOptions.plugins ?? [])],
});
