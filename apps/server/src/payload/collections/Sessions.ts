import type { CollectionConfig } from 'payload';

export const Sessions: CollectionConfig = {
    slug: 'sessions',
    fields: [
        {
            name: 'userId',
            type: 'text',
            required: false,
        },
        {
            name: 'token',
            type: 'text',
            required: false,
        },
        {
            name: 'expiresAt',
            type: 'text',
            required: false,
        },
        {
            name: 'ipAddress',
            type: 'text',
            required: false,
        },
        {
            name: 'userAgent',
            type: 'text',
            required: false,
        },
        {
            name: 'impersonatedBy',
            type: 'text',
            required: false,
        },
    ],
};
