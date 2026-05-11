import type { CollectionConfig } from 'payload';
import { slugField } from 'payload';

export const Categories: CollectionConfig = {
    slug: 'categories',
    admin: {
        useAsTitle: 'title',
    },
    fields: [
        {
            name: 'title',
            type: 'text',
            required: true,
        },
        slugField({
            position: undefined,
        }),
    ],
};
