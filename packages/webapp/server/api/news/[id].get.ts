import { and, eq, ne, or, sql } from 'drizzle-orm';
import { news } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';

/**
 * 资讯详情。仅已发布内容可读（草稿对普通用户返回 404，不暴露存在性）。
 * 每次读取自增浏览量：用 SQL 表达式原地自增，避免并发下读改写丢失计数。
 */
export default defineEventHandler(async (event) => {
    await requireUser(event);
    const id = getRouterParam(event, 'id')!;

    const [row] = await db
        .select()
        .from(news)
        .where(and(eq(news.id, id), eq(news.status, 'published')));
    if (!row) {
        throw createError({ statusCode: 404, statusMessage: '资讯不存在或已下线' });
    }

    await db
        .update(news)
        .set({ viewCount: sql`${news.viewCount} + 1` })
        .where(eq(news.id, id));

    const related = await db
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
        .where(and(eq(news.status, 'published'), ne(news.id, id), row.category ? or(eq(news.category, row.category)) : sql`true`))
        .orderBy(sql`${news.publishedAt} desc nulls last`)
        .limit(4);

    return { ...row, viewCount: row.viewCount + 1, related };
});
