import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
    const baseUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'https://example.com';

    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: ['/admin/', '/api/', '/private/'],
            },
        ],
        sitemap: `${baseUrl}/sitemap.xml`,
    };
}
