import type { GlobalConfig } from 'payload';

export const Header: GlobalConfig = {
    slug: 'header',
    access: {
        read: () => true,
    },
    fields: [
        {
            name: 'navItems',
            type: 'array',
            maxRows: 6,
            fields: [
                {
                    name: 'link',
                    type: 'group',
                    fields: [
                        {
                            name: 'type',
                            type: 'radio',
                            options: [
                                {
                                    label: 'Internal link',
                                    value: 'reference',
                                },
                                {
                                    label: 'Custom URL',
                                    value: 'custom',
                                },
                            ],
                            defaultValue: 'reference',
                            admin: {
                                layout: 'horizontal',
                            },
                        },
                        {
                            name: 'reference',
                            type: 'relationship',
                            relationTo: ['pages', 'posts'],
                            required: true,
                            maxDepth: 1,
                            admin: {
                                condition: (_, siblingData) => siblingData?.type === 'reference',
                            },
                        },
                        {
                            name: 'url',
                            label: 'Custom URL',
                            type: 'text',
                            required: true,
                            admin: {
                                condition: (_, siblingData) => siblingData?.type === 'custom',
                            },
                        },
                        {
                            name: 'label',
                            type: 'text',
                            required: true,
                        },
                    ],
                },
            ],
        },
    ],
};
