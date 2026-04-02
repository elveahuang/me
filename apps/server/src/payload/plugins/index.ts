import { isVercelEnv } from '@/core/db';
import { formBuilderPlugin } from '@payloadcms/plugin-form-builder';
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs';
import { redirectsPlugin } from '@payloadcms/plugin-redirects';
import { searchPlugin } from '@payloadcms/plugin-search';
import { seoPlugin } from '@payloadcms/plugin-seo';
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob';
import { Plugin } from 'payload';

export const plugins: Plugin[] = [
    searchPlugin({
        collections: ['posts'],
    }),
    vercelBlobStorage({
        enabled: isVercelEnv,
        collections: {
            media: true,
        },
        token: process.env.BLOB_READ_WRITE_TOKEN,
    }),
    formBuilderPlugin({
        fields: {
            payment: false,
        },
        formSubmissionOverrides: {
            admin: {
                hidden: ({ user }) => user?.role !== 'admin',
            },
        },
    }),
    redirectsPlugin({
        collections: ['pages', 'posts'],
    }),
    seoPlugin({
        collections: ['pages', 'posts'],
        generateTitle: ({ doc }) => `CMS — ${doc?.title}`,
        generateDescription: ({ doc }) => doc?.excerpt || doc?.meta?.description,
    }),
    nestedDocsPlugin({
        collections: ['categories'],
        generateLabel: (_, doc) => doc.title as string,
        generateURL: (docs) => docs.reduce((url, doc) => `${url}/${doc.slug}`, ''),
    }),
];
