import type { CollectionConfig } from 'payload';

export const Product: CollectionConfig = {
    slug: 'products',
    access: {
        read: () => true,
    },
    fields: [
        {
            name: 'role',
            type: 'text',
            required: true,
        },
        {
            name: 'content',
            type: 'text',
            required: true,
        },
    ],
};
