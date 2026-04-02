import type { Block } from 'payload';

export const Features: Block = {
    slug: 'features',
    interfaceName: 'FeaturesBlock',
    fields: [
        {
            name: 'title',
            type: 'text',
            admin: {
                description: '区块标题',
            },
        },
        {
            name: 'subtitle',
            type: 'text',
            admin: {
                description: '区块副标题',
            },
        },
        {
            name: 'features',
            type: 'array',
            required: true,
            minRows: 1,
            maxRows: 12,
            fields: [
                {
                    name: 'icon',
                    type: 'select',
                    options: [
                        { label: '闪电', value: 'lightning' },
                        { label: '盾牌', value: 'shield' },
                        { label: '齿轮', value: 'cog' },
                        { label: '星星', value: 'star' },
                        { label: '心形', value: 'heart' },
                        { label: '灯泡', value: 'bulb' },
                        { label: '火箭', value: 'rocket' },
                        { label: '图表', value: 'chart' },
                        { label: '锁', value: 'lock' },
                        { label: '云', value: 'cloud' },
                    ],
                    admin: {
                        description: '特性图标',
                    },
                },
                {
                    name: 'title',
                    type: 'text',
                    required: true,
                    admin: {
                        description: '特性标题',
                    },
                },
                {
                    name: 'description',
                    type: 'textarea',
                    admin: {
                        description: '特性描述',
                    },
                },
            ],
            admin: {
                initCollapsed: true,
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
            },
        },
        {
            name: 'style',
            type: 'select',
            defaultValue: 'cards',
            options: [
                { label: '卡片样式', value: 'cards' },
                { label: '简约样式', value: 'minimal' },
                { label: '图标居中', value: 'centered' },
            ],
            admin: {
                description: '展示样式',
            },
        },
    ],
};
