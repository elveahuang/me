import config from '@payload-config';
import { Metadata } from 'next';
import Link from 'next/link';
import { getPayload } from 'payload';
import { PostCard } from './components/PostCard';

export const metadata: Metadata = {
    title: '文章列表',
    description: '浏览所有文章',
};

export default async function PostsPage() {
    const payload = await getPayload({ config });

    const posts = await payload.find({
        collection: 'posts',
        where: {
            _status: { equals: 'published' },
        },
        sort: '-publishedAt',
        limit: 12,
    });

    return (
        <main className='px-4 py-16'>
            <div className='mx-auto max-w-6xl'>
                <h1 className='mb-8 text-4xl font-bold'>文章</h1>

                {posts.docs.length === 0 ? (
                    <p className='text-gray-600 dark:text-gray-400'>暂无文章</p>
                ) : (
                    <div className='grid gap-8 md:grid-cols-2 lg:grid-cols-3'>
                        {posts.docs.map((post) => (
                            <div key={post.id} className='col-span-1'>
                                <PostCard post={post} />
                            </div>
                        ))}
                    </div>
                )}

                {posts.totalPages > 1 && (
                    <div className='mt-12 flex justify-center gap-2'>
                        {Array.from({ length: posts.totalPages }, (_, i) => i + 1).map((page) => (
                            <Link
                                key={page}
                                href={`/posts?page=${page}`}
                                className={`rounded px-4 py-2 ${
                                    page === posts.page ? 'bg-blue-600 text-white' : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600'
                                }`}
                            >
                                {page}
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}
