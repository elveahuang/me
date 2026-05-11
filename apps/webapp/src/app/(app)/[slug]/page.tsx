import { BlockRenderer } from '@/core/components/blocks/BlockRenderer';
import { title } from '@/core/components/primitives';
import config from '@payload-config';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPayload } from 'payload';
import { JSX } from 'react';

interface PageProps {
    params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const payload = await getPayload({ config });

    try {
        const page = await payload.find({
            collection: 'pages',
            where: {
                and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }],
            },
            limit: 1,
        });

        if (page.docs.length === 0) {
            return {
                title: '页面未找到',
            };
        }

        const pageData = page.docs[0];
        const metaTitle = pageData.meta?.title || pageData.title;
        const metaDescription = pageData.meta?.description;

        return {
            title: metaTitle,
            description: metaDescription,
            openGraph: {
                title: metaTitle,
                description: metaDescription,
                images: pageData.meta?.image
                    ? [
                          {
                              url: typeof pageData.meta.image === 'object' ? pageData.meta.image.url : '',
                              alt: metaTitle,
                          },
                      ]
                    : [],
            },
        };
    } catch (error) {
        return {
            title: '页面未找到',
        };
    }
}

export default async function Page({ params }: PageProps): Promise<JSX.Element> {
    const { slug } = await params;
    const payload = await getPayload({ config });

    try {
        const page = await payload.find({
            collection: 'pages',
            where: {
                and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }],
            },
            limit: 1,
        });

        if (page.docs.length === 0) {
            notFound();
        }

        const pageData = page.docs[0];

        return (
            <main>
                {pageData.layout && pageData.layout.length > 0 ? (
                    <BlockRenderer blocks={pageData.layout} />
                ) : (
                    <div className='px-4 py-16'>
                        <div className='mx-auto max-w-4xl text-center'>
                            <h1 className={title()}>{pageData.title}</h1>
                            <p className='mt-4 text-gray-600'>此页面暂无内容</p>
                        </div>
                    </div>
                )}
            </main>
        );
    } catch (error) {
        console.error('Error fetching page:', error);
        notFound();
    }
}

export async function generateStaticParams() {
    const payload = await getPayload({ config });

    try {
        const pages = await payload.find({
            collection: 'pages',
            where: {
                _status: { equals: 'published' },
            },
            limit: 0,
            select: {
                slug: true,
            },
        });

        return pages.docs.map((page) => ({
            slug: page.slug,
        }));
    } catch (error) {
        console.error('Error generating static params:', error);
        return [];
    }
}
