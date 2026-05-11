import type { CollectionConfig } from 'payload';

export const Verifications: CollectionConfig = {
    slug: 'verifications',
    fields: [
        {
            name: 'identifier',
            type: 'text',
            required: false,
        },
        {
            name: 'value',
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
