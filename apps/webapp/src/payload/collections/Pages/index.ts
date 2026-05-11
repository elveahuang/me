import { Banner } from '@/payload/blocks/Banner/config';
import { Content } from '@/payload/blocks/Content/config';
import { CTA } from '@/payload/blocks/CTA/config';
import { Features } from '@/payload/blocks/Features/config';
import { Gallery } from '@/payload/blocks/Gallery/config';
import { Hero } from '@/payload/blocks/Hero/config';
import { Media } from '@/payload/blocks/Media/config';
import { Testimonials } from '@/payload/blocks/Testimonials/config';
import { MetaDescriptionField, MetaImageField, MetaTitleField, OverviewField, PreviewField } from '@payloadcms/plugin-seo/fields';
import type { CollectionConfig } from 'payload';
import { slugField } from 'payload';

export const Pages: CollectionConfig = {
    slug: 'pages',
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
            type: 'tabs',
            tabs: [
                {
                    fields: [
                        {
                            name: 'layout',
                            type: 'blocks',
                            blocks: [Content, Media, Banner, Hero, CTA, Testimonials, Gallery, Features],
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
                description: '设定页面发布的时间，支持定时发布',
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
        slugField(),
    ],
};
