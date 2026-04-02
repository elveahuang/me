import type { CollectionConfig } from 'payload';

import { FixedToolbarFeature, InlineToolbarFeature, lexicalEditor } from '@payloadcms/richtext-lexical';

export const Media: CollectionConfig = {
    slug: 'media',
    access: {
        read: (): true => true,
    },
    fields: [
        {
            name: 'alt',
            type: 'text',
            required: true,
        },
        {
            name: 'caption',
            type: 'richText',
            editor: lexicalEditor({
                features: ({ rootFeatures }) => {
                    return [...rootFeatures, FixedToolbarFeature(), InlineToolbarFeature()];
                },
            }),
        },
    ],
    upload: true,
};
