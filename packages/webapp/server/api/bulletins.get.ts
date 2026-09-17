import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { bulletins } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

/**
 * 用户端宣传栏：返回当前正在投放的内容。
 * 与 isBulletinActive() 保持一致的过滤条件（enabled + 时间窗），
 * 时间窗判断放在数据库侧完成，避免把未生效的运营内容下发到客户端。
 */
export default defineEventHandler(async (event) => {
    await requireUser(event);
    const query = getQuery(event);
    const position = typeof query.position === 'string' && query.position ? query.position : '';

    const now = new Date();
    const filters = [
        eq(bulletins.enabled, true),
        or(isNull(bulletins.startsAt), lte(bulletins.startsAt, now)),
        or(isNull(bulletins.endsAt), gte(bulletins.endsAt, now)),
    ];
    // position=global 时同时命中 home/chat 专用位；反之按位置精确匹配
    if (position) {
        filters.push(or(eq(bulletins.position, position), eq(bulletins.position, 'global'))!);
    }

    const rows = await db
        .select()
        .from(bulletins)
        .where(and(...filters))
        .orderBy(asc(bulletins.sortOrder), desc(bulletins.createdAt));

    return { bulletins: rows };
});
