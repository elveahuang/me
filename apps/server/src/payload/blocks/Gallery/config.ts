import type { Block } from 'payload';

export const Gallery: Block = {
    slug: 'gallery',
    interfaceName: 'GalleryBlock',
    fields: [
        {
            name: 'title',
            type: 'text',
            admin: {
                description: '画廊标题',
            },
        },
        {
            name: 'images',
            type: 'array',
            required: true,
            minRows: 1,
            fields: [
                {
                    name: 'image',
                    type: 'upload',
                    relationTo: 'media',
                    required: true,
                },
                {
                    name: 'caption',
                    type: 'text',
                    admin: {
                        description: '图片说明',
                    },
                },
                {
                    name: 'alt',
                    type: 'text',
                    admin: {
                        description: '替代文本（用于SEO和无障碍访问）',
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
                { label: '瀑布流布局', value: 'masonry' },
                { label: '轮播布局', value: 'carousel' },
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
                { label: '5列', value: '5' },
            ],
            admin: {
                description: '网格列数',
                condition: (_data, siblingData) => siblingData?.layout === 'grid' || siblingData?.layout === 'masonry',
            },
        },
        {
            name: 'enableLightbox',
            type: 'checkbox',
            defaultValue: true,
            admin: {
                description: '启用灯箱效果（点击放大）',
            },
        },
        {
            name: 'enableCaption',
            type: 'checkbox',
            defaultValue: true,
            admin: {
                description: '显示图片说明',
            },
        },
        {
            name: 'aspectRatio',
            type: 'select',
            defaultValue: 'auto',
            options: [
                { label: '自动', value: 'auto' },
                { label: '1:1（正方形）', value: '1:1' },
                { label: '4:3', value: '4:3' },
                { label: '16:9', value: '16:9' },
                { label: '3:2', value: '3:2' },
            ],
            admin: {
                description: '图片宽高比',
            },
        },
    ],
};
