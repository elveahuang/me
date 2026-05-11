import RichText from '@/payload/components/RichText';
import config from '@payload-config';
import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPayload } from 'payload';

interface PostPageProps {
    params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
    const { slug } = await params;
    const payload = await getPayload({ config });

    try {
        const post = await payload.find({
            collection: 'posts',
            where: {
                and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }],
            },
            limit: 1,
        });

        if (post.docs.length === 0) {
            return {
                title: '文章未找到',
            };
        }

        const postData = post.docs[0];
        if (!postData) {
            return { title: '文章未找到' };
        }

        const metaTitle = postData.meta?.title || postData.title;
        const metaDescription = postData.meta?.description;
        const metaData = postData.meta as any;
        const metaImage = typeof metaData?.image === 'object' ? metaData.image.url : '';

        return {
            title: metaTitle || undefined,
            description: metaDescription || undefined,
            openGraph: {
                title: metaTitle || undefined,
                description: metaDescription || undefined,
                type: 'article',
                publishedTime: postData.publishedAt || undefined,
                images: metaImage
                    ? [
                          {
                              url: metaImage,
                              alt: metaTitle,
                          },
                      ]
                    : [],
            },
        };
    } catch (error) {
        return {
            title: '文章未找到',
        };
    }
}

export default async function PostPage({ params }: PostPageProps) {
    const { slug } = await params;
    const payload = await getPayload({ config });

    try {
        const post = await payload.find({
            collection: 'posts',
            where: {
                and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }],
            },
            limit: 1,
        });

        if (post.docs.length === 0 || !post.docs[0]) {
            notFound();
        }

        const postData = post.docs[0];
        const metaData = postData.meta as any;

        const featuredImageUrl =
            typeof postData.featuredImage === 'object' && postData.featuredImage?.url
                ? postData.featuredImage.url
                : typeof metaData?.image === 'object' && metaData?.image?.url
                  ? metaData.image.url
                  : null;

        const firstAuthor = postData.authors?.[0];
        const authorName = typeof firstAuthor === 'object' ? firstAuthor.name || firstAuthor.email : '管理员';

        return (
            <main className='pb-16'>
                <div className='bg-muted/30 border-border/40 mb-12 w-full border-b pt-16 pb-12'>
                    <article className='mx-auto max-w-4xl px-4'>
                        <Link
                            href='/posts'
                            className='text-muted-foreground hover:text-primary mb-6 inline-flex items-center text-sm font-medium transition-colors'
                        >
                            ← 返回文章列表
                        </Link>

                        {postData.categories && postData.categories.length > 0 && (
                            <div className='mb-4 flex gap-2'>
                                {postData.categories.slice(0, 3).map((cat: any) => (
                                    <span
                                        key={cat.id || cat}
                                        className='bg-primary text-primary-foreground inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold shadow transition-colors focus:outline-none'
                                    >
                                        {typeof cat === 'object' ? cat.title : '分类'}
                                    </span>
                                ))}
                            </div>
                        )}

                        <h1 className='mb-6 text-4xl leading-tight font-extrabold tracking-tight md:text-5xl'>{postData.title}</h1>

                        <div className='text-muted-foreground flex items-center gap-4'>
                            <div className='flex items-center gap-2'>
                                <div className='bg-primary/20 text-primary flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold'>
                                    {authorName.charAt(0).toUpperCase()}
                                </div>
                                <span className='text-foreground font-medium'>{authorName}</span>
                            </div>
                            <span className='text-muted-foreground/50'>•</span>
                            <time dateTime={postData.publishedAt ?? undefined}>
                                {postData.publishedAt
                                    ? new Date(postData.publishedAt).toLocaleDateString('zh-CN', {
                                          year: 'numeric',
                                          month: 'long',
                                          day: 'numeric',
                                      })
                                    : '未发布'}
                            </time>
                        </div>
                    </article>
                </div>

                <article className='mx-auto max-w-4xl px-4'>
                    <header className='mb-10'>
                        {featuredImageUrl && (
                            <figure className='border-border/50 overflow-hidden rounded-xl border shadow-sm'>
                                <img src={featuredImageUrl} alt={postData.title} className='max-h-[500px] w-full object-cover' />
                            </figure>
                        )}
                    </header>

                    <div className='prose prose-lg dark:prose-invert max-w-none'>
                        <RichText data={postData.content} />
                    </div>

                    <footer className='mt-12 border-t border-gray-200 pt-8 dark:border-gray-700'>
                        <Link href='/posts' className='font-medium text-blue-600 hover:text-blue-700'>
                            ← 返回文章列表
                        </Link>
                    </footer>
                </article>
            </main>
        );
    } catch (error) {
        console.error('Error fetching post:', error);
        notFound();
    }
}

export async function generateStaticParams() {
    const payload = await getPayload({ config });

    try {
        const posts = await payload.find({
            collection: 'posts',
            where: {
                _status: { equals: 'published' },
            },
            limit: 0,
            select: {
                slug: true,
            },
        });

        return posts.docs.map((post) => ({
            slug: post.slug,
        }));
    } catch (error) {
        console.error('Error generating static params:', error);
        return [];
    }
}
