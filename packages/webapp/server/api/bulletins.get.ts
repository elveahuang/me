import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { bulletins } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';

/**
 * 用户端宣传栏：返回当前正在投放的内容。
 * 与 isBulletinActive() 保持一致的过滤条件（enabled + 时间窗），
 * 时间窗判断放在数据库侧完成，避免把未生效的运营内容下发到客户端。
 *
 * 位置按**精确匹配**：
 * - `home` 只在首页横幅查询里返回，`chat` 只在对话页，`global` 由全站布局渲染
 * - 此前把 home/chat 查询做成「自身 + global」的超集，导致 global 只在个别页面出现，
 *   而「全站」这个标签与实际行为不符；现在每个位置的含义与界面文案一致
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
    if (position) {
        filters.push(eq(bulletins.position, position));
    }

    const rows = await db
        .select()
        .from(bulletins)
        .where(and(...filters))
        .orderBy(asc(bulletins.sortOrder), desc(bulletins.createdAt));

    return { bulletins: rows };
});
