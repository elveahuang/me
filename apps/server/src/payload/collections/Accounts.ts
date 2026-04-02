import type { CollectionConfig } from 'payload';

export const Accounts: CollectionConfig = {
    slug: 'accounts',
    fields: [
        {
            name: 'accountId',
            type: 'text',
            required: false,
        },
        {
            name: 'providerId',
            type: 'text',
            required: false,
        },
        {
            name: 'userId',
            type: 'text',
            required: false,
        },
        {
            name: 'accessToken',
            type: 'checkbox',
            required: false,
        },
        {
            name: 'refreshToken',
            type: 'text',
            required: false,
        },
        {
            name: 'idToken',
            type: 'text',
            required: false,
        },
        {
            name: 'accessTokenExpiresAt',
            type: 'date',
            required: false,
        },
        {
            name: 'refreshTokenExpiresAt',
            type: 'date',
            required: false,
        },
        {
            name: 'scope',
            type: 'text',
            required: false,
        },
        {
            name: 'password',
            type: 'text',
            required: false,
        },
    ],
};
