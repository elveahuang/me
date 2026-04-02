import type { Block } from 'payload';

export const Testimonials: Block = {
    slug: 'testimonials',
    interfaceName: 'TestimonialsBlock',
    fields: [
        {
            name: 'title',
            type: 'text',
            admin: {
                description: '区块标题',
            },
        },
        {
            name: 'testimonials',
            type: 'array',
            required: true,
            minRows: 1,
            maxRows: 10,
            fields: [
                {
                    name: 'quote',
                    type: 'textarea',
                    required: true,
                    admin: {
                        description: '评价内容',
                    },
                },
                {
                    name: 'author',
                    type: 'text',
                    required: true,
                    admin: {
                        description: '评价者姓名',
                    },
                },
                {
                    name: 'role',
                    type: 'text',
                    admin: {
                        description: '评价者职位',
                    },
                },
                {
                    name: 'company',
                    type: 'text',
                    admin: {
                        description: '评价者公司',
                    },
                },
                {
                    name: 'avatar',
                    type: 'upload',
                    relationTo: 'media',
                    admin: {
                        description: '评价者头像',
                    },
                },
                {
                    name: 'rating',
                    type: 'number',
                    min: 1,
                    max: 5,
                    defaultValue: 5,
                    admin: {
                        description: '评分（1-5星）',
                    },
                },
            ],
            admin: {
                initCollapsed: true,
            },
        },
        {
            name: 'layout',
            type: 'select',
            defaultValue: 'grid',
            options: [
                { label: '网格布局', value: 'grid' },
                { label: '轮播布局', value: 'carousel' },
                { label: '列表布局', value: 'list' },
            ],
            admin: {
                description: '展示布局',
            },
        },
        {
            name: 'columns',
            type: 'select',
            defaultValue: '3',
            options: [
                { label: '2列', value: '2' },
                { label: '3列', value: '3' },
                { label: '4列', value: '4' },
            ],
            admin: {
                description: '网格列数',
                condition: (_data, siblingData) => siblingData?.layout === 'grid',
            },
        },
    ],
};
