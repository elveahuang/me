import { Banner } from '@/payload/blocks/Banner/config';
import { Code } from '@/payload/blocks/Code/config';
import { Content } from '@/payload/blocks/Content/config';
import { CTA } from '@/payload/blocks/CTA/config';
import { Features } from '@/payload/blocks/Features/config';
import { Gallery } from '@/payload/blocks/Gallery/config';
import { Hero } from '@/payload/blocks/Hero/config';
import { Media } from '@/payload/blocks/Media/config';
import { Testimonials } from '@/payload/blocks/Testimonials/config';
import { MetaDescriptionField, MetaImageField, MetaTitleField, OverviewField, PreviewField } from '@payloadcms/plugin-seo/fields';
import { BlocksFeature, FixedToolbarFeature, HeadingFeature, HorizontalRuleFeature, InlineToolbarFeature, lexicalEditor } from '@payloadcms/richtext-lexical';
import type { CollectionConfig } from 'payload';
import { slugField } from 'payload';

export const Posts: CollectionConfig = {
    slug: 'posts',
    admin: {
        defaultColumns: ['title', 'slug', 'status', 'updatedAt'],
        useAsTitle: 'title',
    },
    versions: {
        drafts: {
            autosave: {
                interval: 5000,
            },
            schedulePublish: true,
        },
        maxPerDoc: 50,
    },
    fields: [
        {
            name: 'title',
            type: 'text',
            required: true,
        },
        {
            name: 'excerpt',
            type: 'textarea',
            admin: {
                description: '文章摘要（用于列表展示和SEO优化补充）',
            },
        },
        {
            name: 'featuredImage',
            type: 'upload',
            relationTo: 'media',
            admin: {
                description: '文章特色图片/封面图',
            },
        },
        {
            type: 'tabs',
            tabs: [
                {
                    fields: [
                        {
                            name: 'content',
                            type: 'richText',
                            editor: lexicalEditor({
                                features: ({ rootFeatures }) => {
                                    return [
                                        ...rootFeatures,
                                        HeadingFeature({ enabledHeadingSizes: ['h1', 'h2', 'h3', 'h4'] }),
                                        BlocksFeature({ blocks: [Banner, Content, Media, Code, Hero, CTA, Testimonials, Gallery, Features] }),
                                        FixedToolbarFeature(),
                                        InlineToolbarFeature(),
                                        HorizontalRuleFeature(),
                                    ];
                                },
                            }),
                            label: false,
                            required: true,
                        },
                    ],
                    label: 'Content',
                },
                {
                    name: 'meta',
                    label: 'SEO',
                    fields: [
                        OverviewField({
                            titlePath: 'meta.title',
                            descriptionPath: 'meta.description',
                            imagePath: 'meta.image',
                        }),
                        MetaTitleField({
                            hasGenerateFn: true,
                        }),
                        MetaImageField({
                            relationTo: 'media',
                        }),
                        MetaDescriptionField({}),
                        PreviewField({
                            hasGenerateFn: true,
                            titlePath: 'meta.title',
                            descriptionPath: 'meta.description',
                        }),
                    ],
                },
            ],
        },
        {
            name: 'publishedAt',
            type: 'date',
            admin: {
                description: '设定文章发布的时间，支持定时发布',
                date: {
                    pickerAppearance: 'dayAndTime',
                },
                position: 'sidebar',
            },
            hooks: {
                beforeChange: [
                    ({ siblingData, value }) => {
                        if (siblingData._status === 'published' && !value) {
                            return new Date().toISOString();
                        }
                        return value;
                    },
                ],
            },
        },
        {
            name: 'authors',
            type: 'relationship',
            relationTo: 'admins',
            hasMany: true,
            admin: {
                position: 'sidebar',
                description: '文章作者',
            },
        },
        {
            name: 'categories',
            type: 'relationship',
            relationTo: 'categories',
            hasMany: true,
            admin: {
                position: 'sidebar',
                description: '文章分类',
            },
        },
        {
            name: 'tags',
            type: 'relationship',
            relationTo: 'tags',
            hasMany: true,
            admin: {
                position: 'sidebar',
                description: '文章标签',
            },
        },
        slugField(),
    ],
};
