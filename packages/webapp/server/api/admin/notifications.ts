import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { notificationRecipients, notifications, user } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { createNotification } from '../../utils/notify';

/**
 * 消息通知管理（管理端）。
 *
 * 受众语义：
 * - audience=all：全员广播，含未来注册用户（不展开收件人）
 * - audience=users：指定用户，创建时展开收件人，未指定者不可见
 * `targetUsers` 接受 id / 邮箱 / 用户名，服务端统一解析为真实用户 id。
 */
const TYPES = ['system', 'announcement', 'activity', 'billing'];
const LEVELS = ['info', 'success', 'warning', 'danger'];

/** 把混合标识（id / 邮箱 / 用户名）解析为真实用户 id */
async function resolveTargetUserIds(input: unknown): Promise<string[]> {
    const values = [...new Set((Array.isArray(input) ? input : []).map((v) => String(v).trim()).filter(Boolean))];
    if (!values.length) return [];
    const lower = values.map((v) => v.toLowerCase());
    // 逐个条件用 or() 组合，避免 `= any($1)` 的数组绑定在 postgres-js 下被展开成标量参数
    const rows = await db
        .select({ id: user.id })
        .from(user)
        .where(or(inArray(user.id, values), inArray(sql`lower(${user.email})`, lower), inArray(sql`lower(${user.name})`, lower)));
    return [...new Set(rows.map((row) => row.id))];
}

export default defineEventHandler(async (event) => {
    const session = await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = (await readBody(event)) ?? {};
        const title = String(body.title ?? '').trim();
        if (!title) throw createError({ statusCode: 400, statusMessage: '消息标题必填' });

        const audience = body.audience === 'users' ? 'users' : 'all';
        let userIds: string[] = [];
        if (audience === 'users') {
            userIds = await resolveTargetUserIds(body.targetUsers);
            if (!userIds.length) {
                throw createError({ statusCode: 400, statusMessage: '定向推送至少需要选择一个有效用户' });
            }
        }

        const id = await createNotification({
            title,
            content: String(body.content ?? ''),
            type: TYPES.includes(String(body.type)) ? String(body.type) : 'system',
            level: LEVELS.includes(String(body.level)) ? String(body.level) : 'info',
            audience,
            linkUrl: String(body.linkUrl ?? ''),
            createdBy: session.user.id,
            userIds,
        });

        const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
        return { ...row, targetCount: audience === 'users' ? userIds.length : 0, readCount: 0 };
    }

    const query = getQuery(event);
    const audience = typeof query.audience === 'string' && query.audience !== 'all' ? query.audience : '';
    const type = typeof query.type === 'string' && query.type !== 'all' ? query.type : '';
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 20), 100);

    const filters = [];
    if (audience) filters.push(eq(notifications.audience, audience));
    if (type) filters.push(eq(notifications.type, type));
    const where = filters.length ? and(...filters) : undefined;

    const items = await db
        .select({
            id: notifications.id,
            title: notifications.title,
            content: notifications.content,
            type: notifications.type,
            level: notifications.level,
            audience: notifications.audience,
            linkUrl: notifications.linkUrl,
            createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(where);

    // 已读/目标人数：单次聚合查询，避免 N+1
    const ids = items.map((item) => item.id);
    const stats = ids.length
        ? await db
              .select({
                  notificationId: notificationRecipients.notificationId,
                  readCount: sql<number>`count(*) filter (where ${notificationRecipients.readAt} is not null)::int`,
                  targetCount: sql<number>`count(*)::int`,
              })
              .from(notificationRecipients)
              .where(inArray(notificationRecipients.notificationId, ids))
              .groupBy(notificationRecipients.notificationId)
        : [];
    const statsMap = new Map(stats.map((row) => [row.notificationId, row]));

    return {
        items: items.map((item) => ({
            ...item,
            readCount: statsMap.get(item.id)?.readCount ?? 0,
            targetCount: statsMap.get(item.id)?.targetCount ?? 0,
        })),
        total: totalRow?.count ?? 0,
        page,
        pageSize,
    };
});
