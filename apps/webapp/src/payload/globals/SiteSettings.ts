import type { GlobalConfig } from 'payload';

export const SiteSettings: GlobalConfig = {
    slug: 'site-settings',
    access: {
        read: () => true,
    },
    fields: [
        {
            type: 'tabs',
            tabs: [
                {
                    name: 'general',
                    label: '常规设置',
                    fields: [
                        {
                            name: 'siteUrl',
                            type: 'text',
                            admin: {
                                description: '网站URL（用于SEO和分享）',
                            },
                        },
                        {
                            name: 'maintenanceMode',
                            type: 'checkbox',
                            defaultValue: false,
                            admin: {
                                description: '维护模式',
                            },
                        },
                        {
                            name: 'maintenanceMessage',
                            type: 'textarea',
                            admin: {
                                description: '维护模式提示信息',
                                condition: (_data, siblingData) => Boolean(siblingData?.maintenanceMode),
                            },
                        },
                        {
                            name: 'defaultLanguage',
                            type: 'select',
                            defaultValue: 'zh-CN',
                            options: [
                                { label: '简体中文', value: 'zh-CN' },
                                { label: 'English', value: 'en' },
                                { label: '繁體中文', value: 'zh-TW' },
                            ],
                            admin: {
                                description: '默认语言',
                            },
                        },
                        {
                            name: 'timezone',
                            type: 'select',
                            defaultValue: 'Asia/Shanghai',
                            options: [
                                { label: 'Asia/Shanghai (UTC+8)', value: 'Asia/Shanghai' },
                                { label: 'America/New_York (UTC-5)', value: 'America/New_York' },
                                { label: 'Europe/London (UTC+0)', value: 'Europe/London' },
                                { label: 'Europe/Paris (UTC+1)', value: 'Europe/Paris' },
                                { label: 'Asia/Tokyo (UTC+9)', value: 'Asia/Tokyo' },
                            ],
                            admin: {
                                description: '默认时区',
                            },
                        },
                    ],
                },
                {
                    name: 'seo',
                    label: 'SEO 设置',
                    fields: [
                        {
                            name: 'defaultMetaTitle',
                            type: 'text',
                            admin: {
                                description: '默认Meta标题',
                            },
                        },
                        {
                            name: 'defaultMetaDescription',
                            type: 'textarea',
                            admin: {
                                description: '默认Meta描述',
                            },
                        },
                        {
                            name: 'defaultMetaImage',
                            type: 'upload',
                            relationTo: 'media',
                            admin: {
                                description: '默认Meta图片（用于社交分享）',
                            },
                        },
                        {
                            name: 'enableIndexing',
                            type: 'checkbox',
                            defaultValue: true,
                            admin: {
                                description: '允许搜索引擎索引',
                            },
                        },
                        {
                            name: 'googleSiteVerification',
                            type: 'text',
                            admin: {
                                description: 'Google站点验证代码',
                            },
                        },
                        {
                            name: 'baiduSiteVerification',
                            type: 'text',
                            admin: {
                                description: '百度站点验证代码',
                            },
                        },
                        {
                            name: 'customHeadCode',
                            type: 'textarea',
                            admin: {
                                description: '自定义Head代码（添加到所有页面<head>中）',
                            },
                        },
                        {
                            name: 'customBodyCode',
                            type: 'textarea',
                            admin: {
                                description: '自定义Body代码（添加到所有页面<body>末尾）',
                            },
                        },
                    ],
                },
                {
                    name: 'analytics',
                    label: '统计分析',
                    fields: [
                        {
                            name: 'googleAnalyticsId',
                            type: 'text',
                            admin: {
                                description: 'Google Analytics ID (GA4)',
                            },
                        },
                        {
                            name: 'baiduAnalyticsId',
                            type: 'text',
                            admin: {
                                description: '百度统计ID',
                            },
                        },
                        {
                            name: 'enableHotjar',
                            type: 'checkbox',
                            defaultValue: false,
                            admin: {
                                description: '启用Hotjar',
                            },
                        },
                        {
                            name: 'hotjarId',
                            type: 'text',
                            admin: {
                                description: 'Hotjar Site ID',
                                condition: (_data, siblingData) => Boolean(siblingData?.enableHotjar),
                            },
                        },
                    ],
                },
                {
                    name: 'social',
                    label: '社交媒体',
                    fields: [
                        {
                            name: 'socialLinks',
                            type: 'array',
                            fields: [
                                {
                                    name: 'platform',
                                    type: 'select',
                                    required: true,
                                    options: [
                                        { label: '微信', value: 'wechat' },
                                        { label: '微博', value: 'weibo' },
                                        { label: 'GitHub', value: 'github' },
                                        { label: 'Twitter/X', value: 'twitter' },
                                        { label: 'LinkedIn', value: 'linkedin' },
                                        { label: 'Facebook', value: 'facebook' },
                                        { label: 'Instagram', value: 'instagram' },
                                        { label: 'YouTube', value: 'youtube' },
                                        { label: '抖音', value: 'douyin' },
                                        { label: '小红书', value: 'xiaohongshu' },
                                    ],
                                },
                                {
                                    name: 'url',
                                    type: 'text',
                                    required: true,
                                },
                            ],
                            admin: {
                                initCollapsed: true,
                                description: '社交媒体链接',
                            },
                        },
                        {
                            name: 'wechatQrCode',
                            type: 'upload',
                            relationTo: 'media',
                            admin: {
                                description: '微信公众号二维码',
                            },
                        },
                    ],
                },
                {
                    name: 'performance',
                    label: '性能设置',
                    fields: [
                        {
                            name: 'enableCaching',
                            type: 'checkbox',
                            defaultValue: true,
                            admin: {
                                description: '启用缓存',
                            },
                        },
                        {
                            name: 'cacheDuration',
                            type: 'number',
                            defaultValue: 3600,
                            admin: {
                                description: '缓存时长（秒）',
                                condition: (_data, siblingData) => Boolean(siblingData?.enableCaching),
                            },
                        },
                        {
                            name: 'enableImageOptimization',
                            type: 'checkbox',
                            defaultValue: true,
                            admin: {
                                description: '启用图片优化',
                            },
                        },
                        {
                            name: 'lazyLoadImages',
                            type: 'checkbox',
                            defaultValue: true,
                            admin: {
                                description: '图片懒加载',
                            },
                        },
                        {
                            name: 'enableMinification',
                            type: 'checkbox',
                            defaultValue: true,
                            admin: {
                                description: '启用代码压缩',
                            },
                        },
                    ],
                },
            ],
        },
    ],
};
