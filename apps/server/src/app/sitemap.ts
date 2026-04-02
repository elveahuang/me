import config from '@payload-config';
import type { MetadataRoute } from 'next';
import { getPayload } from 'payload';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const payload = await getPayload({ config });
    const baseUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'https://example.com';

    const sitemapEntries: MetadataRoute.Sitemap = [];

    try {
        const pages = await payload.find({
            collection: 'pages',
            where: {
                _status: { equals: 'published' },
            },
            limit: 0,
            select: {
                slug: true,
                updatedAt: true,
                publishedAt: true,
            },
        });

        for (const page of pages.docs) {
            sitemapEntries.push({
                url: `${baseUrl}/${page.slug}`,
                lastModified: new Date(page.updatedAt),
                changeFrequency: 'weekly',
                priority: page.slug === 'home' ? 1.0 : 0.8,
            });
        }

        const posts = await payload.find({
            collection: 'posts',
            where: {
                _status: { equals: 'published' },
            },
            limit: 0,
            select: {
                slug: true,
                updatedAt: true,
                publishedAt: true,
            },
        });

        for (const post of posts.docs) {
            sitemapEntries.push({
                url: `${baseUrl}/posts/${post.slug}`,
                lastModified: new Date(post.updatedAt),
                changeFrequency: 'daily',
                priority: 0.7,
            });
        }

        sitemapEntries.push({
            url: baseUrl,
            lastModified: new Date(),
            changeFrequency: 'daily',
            priority: 1.0,
        });
    } catch (error) {
        console.error('Error generating sitemap:', error);
    }

    return sitemapEntries;
}
