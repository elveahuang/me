import type { CollectionConfig } from 'payload';
import { slugField } from 'payload';

export const Tags: CollectionConfig = {
    slug: 'tags',
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
