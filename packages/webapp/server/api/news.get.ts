import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { news } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

/**
 * 用户端资讯列表：只返回已发布内容。
 * `pinned` 优先排序；分页字段与共享契约 NewsListResponse 保持一致。
 * 列表不返回正文，避免首屏传输大量 Markdown。
 */
export default defineEventHandler(async (event) => {
    await requireUser(event);
    const query = getQuery(event);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 10), 50);
    const category = typeof query.category === 'string' && query.category !== 'all' ? query.category : '';
    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';

    const published = and(eq(news.status, 'published'), or(isNull(news.publishedAt), lte(news.publishedAt, new Date())));
    const filters = [published];
    if (category) filters.push(eq(news.category, category));
    if (keyword) filters.push(sql`(${news.title} ilike ${`%${keyword}%`} or ${news.summary} ilike ${`%${keyword}%`})`);
    const where = and(...filters);

    const items = await db
        .select({
            id: news.id,
            title: news.title,
            summary: news.summary,
            coverImage: news.coverImage,
            category: news.category,
            tags: news.tags,
            pinned: news.pinned,
            viewCount: news.viewCount,
            publishedAt: news.publishedAt,
            createdAt: news.createdAt,
        })
        .from(news)
        .where(where)
        .orderBy(desc(news.pinned), desc(news.publishedAt), desc(news.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(news)
        .where(where);

    const categories = await db
        .select({ category: news.category, count: sql<number>`count(*)::int` })
        .from(news)
        .where(published)
        .groupBy(news.category)
        .orderBy(asc(news.category));

    return {
        items,
        total: totalRow?.count ?? 0,
        page,
        pageSize,
        categories: categories.map((row) => ({ value: row.category, count: row.count })),
    };
});
