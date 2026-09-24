import { and, desc, eq, sql } from 'drizzle-orm';
import { news } from '../../db/schema';
import { normalizeNewsBody } from '../../utils/content-ops';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { requireMethod } from '../../utils/method';
import { intParam, likePattern } from '../../utils/query';

/**
 * 资讯管理（管理端）。
 * GET 支持 status / category / keyword 筛选与分页；POST 新建（默认草稿）。
 * 请求体归一与 PATCH 共用 normalizeNewsBody：published 必有发布时间的不变式
 * （保证用户端 desc(publishedAt) 排序可用）在那里统一维护，不再各写一份。
 */
export default defineEventHandler(async (event) => {
    const session = await requireAdmin(event);

    // 其余方法（PUT/PATCH/DELETE）原本落进下面的读取分支：请求拿到 200 + 列表，看起来像写成功了
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        const patch = normalizeNewsBody(body);
        // 标题必填：提供了但 trim 后为空由 normalizeNewsBody 抛 400，新建连「没提供」也要挡在这里
        const title = String(patch.title ?? '');
        if (!title) throw createError({ statusCode: 400, statusMessage: '标题必填' });

        const id = crypto.randomUUID();
        await db.insert(news).values({
            id,
            title,
            summary: String(patch.summary ?? ''),
            content: String(patch.content ?? ''),
            coverImage: String(patch.coverImage ?? ''),
            category: String(patch.category ?? 'general') || 'general',
            tags: (patch.tags as string[]) ?? [],
            status: String(patch.status ?? 'draft'),
            pinned: patch.pinned === true,
            authorId: session.user.id,
            publishedAt: (patch.publishedAt as Date | null) ?? null,
        });
        const [row] = await db.select().from(news).where(eq(news.id, id));
        return row;
    }

    const query = getQuery(event);
    const status = typeof query.status === 'string' && query.status !== 'all' ? query.status : '';
    const category = typeof query.category === 'string' && query.category !== 'all' ? query.category : '';
    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
    const page = intParam(query.page, 1, 1, 1e6);
    const pageSize = intParam(query.pageSize, 20, 1, 100);

    const filters = [];
    if (status) filters.push(eq(news.status, status));
    if (category) filters.push(eq(news.category, category));
    if (keyword) filters.push(sql`(${news.title} ilike ${likePattern(keyword)} or ${news.summary} ilike ${likePattern(keyword)})`);
    const where = filters.length ? and(...filters) : undefined;

    const items = await db
        .select({
            id: news.id,
            title: news.title,
            summary: news.summary,
            coverImage: news.coverImage,
            category: news.category,
            tags: news.tags,
            status: news.status,
            pinned: news.pinned,
            viewCount: news.viewCount,
            publishedAt: news.publishedAt,
            createdAt: news.createdAt,
            updatedAt: news.updatedAt,
        })
        .from(news)
        .where(where)
        .orderBy(desc(news.pinned), desc(news.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(news)
        .where(where);
    return { items, total: totalRow?.count ?? 0, page, pageSize };
});
