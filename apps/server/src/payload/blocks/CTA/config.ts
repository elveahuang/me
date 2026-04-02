import { link } from '@/payload/fields/link';
import { FixedToolbarFeature, HeadingFeature, InlineToolbarFeature, lexicalEditor } from '@payloadcms/richtext-lexical';
import type { Block } from 'payload';

export const CTA: Block = {
    slug: 'cta',
    interfaceName: 'CTABlock',
    fields: [
        {
            name: 'title',
            type: 'text',
            required: true,
            admin: {
                description: '行动号召标题',
            },
        },
        {
            name: 'description',
            type: 'richText',
            editor: lexicalEditor({
                features: ({ rootFeatures }) => {
                    return [...rootFeatures, HeadingFeature({ enabledHeadingSizes: ['h3', 'h4'] }), FixedToolbarFeature(), InlineToolbarFeature()];
                },
            }),
            admin: {
                description: '描述内容',
            },
        },
        {
            name: 'actions',
            type: 'array',
            maxRows: 3,
            fields: [
                link({
                    appearances: ['default', 'outline'],
                }),
            ],
            admin: {
                initCollapsed: true,
                description: '行动按钮（最多3个）',
            },
        },
        {
            name: 'backgroundColor',
            type: 'select',
            defaultValue: 'primary',
            options: [
                { label: '主要色', value: 'primary' },
                { label: '次要色', value: 'secondary' },
                { label: '强调色', value: 'accent' },
                { label: '浅灰色', value: 'light' },
                { label: '深灰色', value: 'dark' },
            ],
            admin: {
                description: '背景颜色',
            },
        },
        {
            name: 'alignment',
            type: 'select',
            defaultValue: 'center',
            options: [
                { label: '左对齐', value: 'left' },
                { label: '居中', value: 'center' },
                { label: '右对齐', value: 'right' },
            ],
            admin: {
                description: '内容对齐方式',
            },
        },
    ],
};
