import type { CollectionConfig } from 'payload';

export const Jwks: CollectionConfig = {
    slug: 'jwks',
    fields: [
        {
            name: 'publicKey',
            type: 'text',
            required: false,
        },
        {
            name: 'privateKey',
            type: 'text',
            required: false,
        },
        {
            name: 'expiresAt',
            type: 'date',
            required: false,
        },
    ],
};
