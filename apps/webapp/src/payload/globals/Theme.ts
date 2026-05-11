import type { GlobalConfig } from 'payload';

export const Theme: GlobalConfig = {
    slug: 'theme',
    access: {
        read: () => true,
    },
    fields: [
        {
            name: 'siteName',
            type: 'text',
            required: true,
            defaultValue: 'My CMS',
            admin: {
                description: '网站名称',
            },
        },
        {
            name: 'siteDescription',
            type: 'textarea',
            admin: {
                description: '网站描述',
            },
        },
        {
            name: 'logo',
            type: 'upload',
            relationTo: 'media',
            admin: {
                description: '网站Logo',
            },
        },
        {
            name: 'favicon',
            type: 'upload',
            relationTo: 'media',
            admin: {
                description: '网站图标',
            },
        },
        {
            type: 'tabs',
            tabs: [
                {
                    name: 'colors',
                    label: '颜色配置',
                    fields: [
                        {
                            name: 'primaryColor',
                            type: 'text',
                            defaultValue: '#3B82F6',
                            admin: {
                                description: '主要颜色（十六进制）',
                                components: {
                                    Field: {
                                        path: '@/payload/components/ColorPicker',
                                    },
                                },
                            },
                        },
                        {
                            name: 'secondaryColor',
                            type: 'text',
                            defaultValue: '#6B7280',
                            admin: {
                                description: '次要颜色（十六进制）',
                            },
                        },
                        {
                            name: 'accentColor',
                            type: 'text',
                            defaultValue: '#10B981',
                            admin: {
                                description: '强调颜色（十六进制）',
                            },
                        },
                        {
                            name: 'backgroundColor',
                            type: 'text',
                            defaultValue: '#FFFFFF',
                            admin: {
                                description: '背景颜色（十六进制）',
                            },
                        },
                        {
                            name: 'textColor',
                            type: 'text',
                            defaultValue: '#1F2937',
                            admin: {
                                description: '文字颜色（十六进制）',
                            },
                        },
                        {
                            name: 'darkMode',
                            type: 'group',
                            fields: [
                                {
                                    name: 'enabled',
                                    type: 'checkbox',
                                    defaultValue: true,
                                    admin: {
                                        description: '启用暗黑模式',
                                    },
                                },
                                {
                                    name: 'primaryColor',
                                    type: 'text',
                                    defaultValue: '#60A5FA',
                                    admin: {
                                        description: '暗黑模式主要颜色',
                                    },
                                },
                                {
                                    name: 'backgroundColor',
                                    type: 'text',
                                    defaultValue: '#111827',
                                    admin: {
                                        description: '暗黑模式背景颜色',
                                    },
                                },
                                {
                                    name: 'textColor',
                                    type: 'text',
                                    defaultValue: '#F9FAFB',
                                    admin: {
                                        description: '暗黑模式文字颜色',
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: 'typography',
                    label: '字体配置',
                    fields: [
                        {
                            name: 'fontFamily',
                            type: 'select',
                            defaultValue: 'inter',
                            options: [
                                { label: 'Inter', value: 'inter' },
                                { label: 'Roboto', value: 'roboto' },
                                { label: 'Open Sans', value: 'open-sans' },
                                { label: 'Lato', value: 'lato' },
                                { label: 'Montserrat', value: 'montserrat' },
                                { label: 'Poppins', value: 'poppins' },
                                { label: 'Noto Sans SC (中文)', value: 'noto-sans-sc' },
                                { label: 'Source Han Sans (思源黑体)', value: 'source-han-sans' },
                            ],
                            admin: {
                                description: '主要字体',
                            },
                        },
                        {
                            name: 'headingFontFamily',
                            type: 'select',
                            defaultValue: 'inter',
                            options: [
                                { label: '与主字体相同', value: 'inherit' },
                                { label: 'Inter', value: 'inter' },
                                { label: 'Playfair Display', value: 'playfair-display' },
                                { label: 'Merriweather', value: 'merriweather' },
                                { label: 'Montserrat', value: 'montserrat' },
                                { label: 'Poppins', value: 'poppins' },
                            ],
                            admin: {
                                description: '标题字体',
                            },
                        },
                        {
                            name: 'baseFontSize',
                            type: 'number',
                            defaultValue: 16,
                            min: 12,
                            max: 20,
                            admin: {
                                description: '基础字体大小（px）',
                            },
                        },
                        {
                            name: 'lineHeight',
                            type: 'number',
                            defaultValue: 1.6,
                            min: 1.0,
                            max: 2.0,
                            admin: {
                                description: '行高',
                            },
                        },
                    ],
                },
                {
                    name: 'layout',
                    label: '布局配置',
                    fields: [
                        {
                            name: 'containerWidth',
                            type: 'select',
                            defaultValue: '1200',
                            options: [
                                { label: '窄 (960px)', value: '960' },
                                { label: '标准 (1200px)', value: '1200' },
                                { label: '宽 (1440px)', value: '1440' },
                                { label: '全宽', value: '100%' },
                            ],
                            admin: {
                                description: '容器最大宽度',
                            },
                        },
                        {
                            name: 'borderRadius',
                            type: 'select',
                            defaultValue: 'medium',
                            options: [
                                { label: '无圆角', value: 'none' },
                                { label: '小圆角', value: 'small' },
                                { label: '中等圆角', value: 'medium' },
                                { label: '大圆角', value: 'large' },
                                { label: '全圆角', value: 'full' },
                            ],
                            admin: {
                                description: '全局圆角风格',
                            },
                        },
                        {
                            name: 'spacing',
                            type: 'select',
                            defaultValue: 'normal',
                            options: [
                                { label: '紧凑', value: 'compact' },
                                { label: '正常', value: 'normal' },
                                { label: '宽松', value: 'relaxed' },
                            ],
                            admin: {
                                description: '全局间距风格',
                            },
                        },
                    ],
                },
                {
                    name: 'header',
                    label: '页眉配置',
                    fields: [
                        {
                            name: 'style',
                            type: 'select',
                            defaultValue: 'default',
                            options: [
                                { label: '默认', value: 'default' },
                                { label: '透明', value: 'transparent' },
                                { label: '固定', value: 'fixed' },
                                { label: '居中Logo', value: 'centered' },
                            ],
                            admin: {
                                description: '页眉样式',
                            },
                        },
                        {
                            name: 'showSearch',
                            type: 'checkbox',
                            defaultValue: true,
                            admin: {
                                description: '显示搜索框',
                            },
                        },
                        {
                            name: 'showThemeToggle',
                            type: 'checkbox',
                            defaultValue: true,
                            admin: {
                                description: '显示主题切换按钮',
                            },
                        },
                    ],
                },
                {
                    name: 'footer',
                    label: '页脚配置',
                    fields: [
                        {
                            name: 'showFooter',
                            type: 'checkbox',
                            defaultValue: true,
                            admin: {
                                description: '显示页脚',
                            },
                        },
                        {
                            name: 'copyrightText',
                            type: 'text',
                            admin: {
                                description: '版权信息',
                            },
                        },
                        {
                            name: 'columns',
                            type: 'array',
                            maxRows: 4,
                            fields: [
                                {
                                    name: 'title',
                                    type: 'text',
                                    required: true,
                                },
                                {
                                    name: 'links',
                                    type: 'array',
                                    fields: [
                                        {
                                            name: 'label',
                                            type: 'text',
                                            required: true,
                                        },
                                        {
                                            name: 'url',
                                            type: 'text',
                                            required: true,
                                        },
                                        {
                                            name: 'openInNewTab',
                                            type: 'checkbox',
                                            defaultValue: false,
                                        },
                                    ],
                                },
                            ],
                            admin: {
                                initCollapsed: true,
                                description: '页脚链接列',
                            },
                        },
                    ],
                },
            ],
        },
    ],
};
