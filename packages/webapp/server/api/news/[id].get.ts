import { and, desc, eq, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { news } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';
import { cacheGet, cacheSet } from '../../utils/redis';

/**
 * 资讯详情。仅已发布内容可读（草稿对普通用户返回 404，不暴露存在性）。
 *
 * 浏览量去重：同一用户对同一篇资讯在 VIEW_DEDUP_WINDOW_SECONDS 内只计一次。
 * 详情页会被 SSR 首屏、客户端切换、浏览器刷新和预取反复请求，
 * 不去重的话浏览量会随刷新线性虚高，失去运营参考价值。
 * Redis 可用时借助缓存做跨实例去重，否则退化为进程内 Map（与限流一致的降级策略）。
 */

const VIEW_DEDUP_WINDOW_SECONDS = 1800;
const VIEW_DEDUP_WINDOW_MS = VIEW_DEDUP_WINDOW_SECONDS * 1000;

/** 进程内去重表（Redis 不可用时的降级路径） */
const memoryViews = new Map<string, number>();

/** 清理过期项，防止 Map 无限增长；低频调用，开销可忽略 */
function pruneMemoryViews(now: number) {
    if (memoryViews.size < 5000) return;
    for (const [key, expiresAt] of memoryViews) {
        if (expiresAt <= now) memoryViews.delete(key);
    }
}

/** 返回 true 表示本次应计入浏览量（即该用户在窗口内首次阅读） */
async function shouldCountView(newsId: string, userId: string): Promise<boolean> {
    const key = `news:view:${newsId}:${userId}`;
    const now = Date.now();

    const cached = await cacheGet<number>(key);
    if (cached !== null && cached !== undefined && now - Number(cached) < VIEW_DEDUP_WINDOW_MS) {
        return false;
    }

    // 无论 Redis 是否可用都写内存，保证单实例下行为一致
    pruneMemoryViews(now);
    const memoryExpiry = memoryViews.get(key);
    if (memoryExpiry && memoryExpiry > now) return false;
    memoryViews.set(key, now + VIEW_DEDUP_WINDOW_MS);

    await cacheSet(key, now, VIEW_DEDUP_WINDOW_SECONDS);
    return true;
}

export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const id = getRouterParam(event, 'id')!;

    // 与列表口径一致：已发布且发布时间已到（publishedAt 为空视为立即可见）。
    // 只判 status 会让「定时发布、publishedAt 在未来」的文章通过直链提前读到。
    const published = and(eq(news.status, 'published'), or(isNull(news.publishedAt), lte(news.publishedAt, new Date())));

    const [row] = await db
        .select()
        .from(news)
        .where(and(published, eq(news.id, id)));
    if (!row) {
        throw createError({ statusCode: 404, statusMessage: '资讯不存在或已下线' });
    }

    const counted = await shouldCountView(id, session.user.id);
    let viewCount = row.viewCount;
    if (counted) {
        // 原地自增，避免并发读改写丢失计数
        await db
            .update(news)
            .set({ viewCount: sql`${news.viewCount} + 1` })
            .where(eq(news.id, id));
        viewCount += 1;
    }

    // 相关推荐：优先同分类，不足时用其他已发布内容补足，保证始终尽量给满 4 条
    const sameCategory = row.category
        ? await db
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
              .where(and(published, ne(news.id, id), eq(news.category, row.category)))
              .orderBy(desc(news.publishedAt))
              .limit(4)
        : [];

    let related = sameCategory;
    if (related.length < 4) {
        const excludeIds = [id, ...related.map((item) => item.id)];
        const fill = await db
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
            .where(and(published, notInArray(news.id, excludeIds)))
            .orderBy(desc(news.pinned), desc(news.publishedAt))
            .limit(4 - related.length);
        related = [...related, ...fill];
    }

    return { ...row, viewCount, related, viewCounted: counted };
});
