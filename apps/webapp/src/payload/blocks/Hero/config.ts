import { link } from '@/payload/fields/link';
import type { Block } from 'payload';

export const Hero: Block = {
    slug: 'hero',
    interfaceName: 'HeroBlock',
    fields: [
        {
            name: 'type',
            type: 'select',
            defaultValue: 'highImpact',
            options: [
                { label: '高影响力', value: 'highImpact' },
                { label: '中等影响力', value: 'mediumImpact' },
                { label: '低影响力', value: 'lowImpact' },
            ],
            required: true,
        },
        {
            name: 'title',
            type: 'text',
            required: true,
            admin: {
                description: '主标题文字',
            },
        },
        {
            name: 'subtitle',
            type: 'text',
            admin: {
                description: '副标题文字',
            },
        },
        {
            name: 'description',
            type: 'textarea',
            admin: {
                description: '描述文字',
            },
        },
        {
            name: 'media',
            type: 'upload',
            relationTo: 'media',
            admin: {
                description: '背景图片或视频',
            },
        },
        {
            name: 'actions',
            type: 'array',
            maxRows: 2,
            fields: [
                link({
                    appearances: ['default', 'outline'],
                }),
            ],
            admin: {
                initCollapsed: true,
                description: '行动按钮（最多2个）',
            },
        },
        {
            name: 'enableBackgroundOverlay',
            type: 'checkbox',
            defaultValue: true,
            admin: {
                description: '启用背景遮罩层',
                condition: (_data, siblingData) => Boolean(siblingData?.media),
            },
        },
        {
            name: 'overlayOpacity',
            type: 'number',
            defaultValue: 50,
            min: 0,
            max: 100,
            admin: {
                description: '遮罩层透明度（0-100）',
                condition: (_data, siblingData) => Boolean(siblingData?.enableBackgroundOverlay),
            },
        },
    ],
};
