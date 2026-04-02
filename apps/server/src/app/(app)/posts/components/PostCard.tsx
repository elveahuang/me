'use client';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@heroui/react';
import Link from 'next/link';

export function PostCard({ post }: { post: any }) {
    const featuredImageUrl =
        typeof post.featuredImage === 'object' && post.featuredImage?.url
            ? post.featuredImage.url
            : typeof post.meta?.image === 'object' && post.meta?.image?.url
              ? post.meta.image.url
              : null;

    const firstAuthor = post.authors?.[0];
    const authorName = typeof firstAuthor === 'object' ? firstAuthor.name || firstAuthor.email : '管理员';

    const publishDate = post.publishedAt
        ? new Date(post.publishedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
        : '未发布';

    return (
        <Card className='border-border/50 bg-card flex h-full flex-col overflow-hidden border transition-shadow hover:shadow-xl'>
            <div className='group relative p-0'>
                {featuredImageUrl ? (
                    <img
                        alt={post.title}
                        className='z-0 h-48 w-full object-cover transition-transform duration-500 group-hover:scale-105'
                        src={featuredImageUrl}
                    />
                ) : (
                    <div className='bg-muted flex h-48 w-full items-center justify-center transition-transform duration-500 group-hover:scale-105'>
                        <span className='text-muted-foreground text-sm'>无封面图</span>
                    </div>
                )}
                {post.categories && post.categories.length > 0 && (
                    <div className='absolute top-2 right-2 z-10 flex gap-1'>
                        {post.categories.slice(0, 2).map((cat: any) => (
                            <span
                                key={cat.id || cat}
                                className='bg-primary text-primary-foreground inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold shadow transition-colors focus:outline-none'
                            >
                                {typeof cat === 'object' ? cat.title : '分类'}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <CardHeader className='pt-4 pb-2'>
                <p className='text-primary mb-2 text-xs font-bold tracking-wider uppercase'>{publishDate}</p>
                <CardTitle className='line-clamp-2 text-xl font-bold'>
                    <Link href={`/posts/${post.slug}`} className='hover:text-primary transition-colors hover:underline'>
                        {post.title}
                    </Link>
                </CardTitle>
                <CardDescription className='text-muted-foreground mt-2 line-clamp-3 text-sm'>
                    {post.excerpt || post.meta?.description || '暂无摘要'}
                </CardDescription>
            </CardHeader>
            <CardContent className='flex-grow gap-2 pb-0'>
                {post.tags && post.tags.length > 0 && (
                    <div className='mt-2 flex flex-wrap gap-1'>
                        {post.tags.slice(0, 3).map((tag: any) => (
                            <span
                                key={tag.id || tag}
                                className='bg-secondary text-secondary-foreground hover:bg-secondary/80 inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none'
                            >
                                {typeof tag === 'object' ? tag.title : '标签'}
                            </span>
                        ))}
                    </div>
                )}
            </CardContent>
            <CardFooter className='items-center justify-between pt-4 pb-4'>
                <div className='flex items-center gap-2'>
                    <div className='bg-muted text-muted-foreground flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold'>
                        {authorName.charAt(0).toUpperCase()}
                    </div>
                    <div className='flex flex-col'>
                        <span className='text-sm font-medium'>{authorName}</span>
                    </div>
                </div>
                <Link href={`/posts/${post.slug}`} className='text-primary text-sm font-medium hover:underline'>
                    阅读 →
                </Link>
            </CardFooter>
        </Card>
    );
}
