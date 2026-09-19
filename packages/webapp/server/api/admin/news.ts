import { and, desc, eq, sql } from 'drizzle-orm';
import { news } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

/**
 * 资讯管理（管理端）。
 * GET 支持 status / category / keyword 筛选与分页；POST 新建（默认草稿）。
 * 状态为 published 且未设置 publishedAt 时自动补当前时间，保证用户端排序可用。
 */
const EDITABLE = ['title', 'summary', 'content', 'coverImage', 'category'] as const;

function normalizeBody(body: Record<string, unknown>, forCreate: boolean) {
    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE) {
        if (body[key] !== undefined) patch[key] = body[key] === null ? '' : String(body[key]);
    }
    if (body.tags !== undefined) {
        patch.tags = Array.isArray(body.tags) ? body.tags.map((v: unknown) => String(v).trim()).filter(Boolean) : [];
    }
    if (body.pinned !== undefined) patch.pinned = Boolean(body.pinned);
    if (body.status !== undefined) {
        const status = body.status === 'published' ? 'published' : 'draft';
        patch.status = status;
        // 首次发布时补发布时间；取消发布不清空，便于重新上线时保留原时间
        if (status === 'published' && body.publishedAt === undefined && forCreate) {
            patch.publishedAt = new Date();
        }
    }
    if (body.publishedAt !== undefined) {
        patch.publishedAt = body.publishedAt ? new Date(String(body.publishedAt)) : null;
    }
    return patch;
}

export default defineEventHandler(async (event) => {
    const session = await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = (await readBody(event)) ?? {};
        const patch = normalizeBody(body, true);
        const title = String(patch.title ?? '').trim();
        if (!title) throw createError({ statusCode: 400, statusMessage: '标题必填' });
        if (patch.status === 'published' && !patch.publishedAt) patch.publishedAt = new Date();

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
            pinned: Boolean(patch.pinned),
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
    const page = Math.min(Math.max(1, Math.floor(Number(query.page)) || 1), 1e6); // 上界夹逼并取整：?page=Infinity/小数/超大值会让 offset 溢出或非整数而被 PG 拒绝
    const pageSize = Math.min(Math.max(1, Math.floor(Number(query.pageSize)) || 20), 100);

    const filters = [];
    if (status) filters.push(eq(news.status, status));
    if (category) filters.push(eq(news.category, category));
    if (keyword) filters.push(sql`(${news.title} ilike ${`%${keyword}%`} or ${news.summary} ilike ${`%${keyword}%`})`);
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
