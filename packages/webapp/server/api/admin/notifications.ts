import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { notificationRecipients, notifications, user } from '../../db/schema';
import { assertContentLen, normalizeLink } from '../../utils/content-ops';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { requireMethod } from '../../utils/method';
import { createNotification } from '../../utils/notify';
import { intParam } from '../../utils/query';

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

/** 定向收件人上限：收件人行是一条 INSERT 的 values，无上限会让参数数量随请求体线性膨胀 */
const TARGET_USERS_MAX = 500;

/** 把混合标识（id / 邮箱 / 用户名）解析为真实用户 id */
async function resolveTargetUserIds(input: unknown): Promise<string[]> {
    const values = [...new Set((Array.isArray(input) ? input : []).map((v) => String(v).trim()).filter(Boolean))];
    if (values.length > TARGET_USERS_MAX) {
        throw createError({ statusCode: 400, statusMessage: `定向推送最多 ${TARGET_USERS_MAX} 个用户，其余请使用全员广播` });
    }
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

    // 其余方法（PUT/PATCH/DELETE）原本落进下面的读取分支：请求拿到 200 + 列表，看起来像写成功了
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        const title = String(body.title ?? '').trim();
        if (!title) throw createError({ statusCode: 400, statusMessage: '消息标题必填' });
        assertContentLen(title, 200, '消息标题');

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
            content: assertContentLen(String(body.content ?? ''), 5000, '消息内容'),
            type: TYPES.includes(String(body.type)) ? String(body.type) : 'system',
            level: LEVELS.includes(String(body.level)) ? String(body.level) : 'info',
            audience,
            linkUrl: normalizeLink(body.linkUrl),
            createdBy: session.user.id,
            userIds,
        });

        const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
        return { ...row, targetCount: audience === 'users' ? userIds.length : 0, readCount: 0 };
    }

    const query = getQuery(event);
    const audience = typeof query.audience === 'string' && query.audience !== 'all' ? query.audience : '';
    const type = typeof query.type === 'string' && query.type !== 'all' ? query.type : '';
    const page = intParam(query.page, 1, 1, 1e6);
    const pageSize = intParam(query.pageSize, 20, 1, 100);

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

    /**
     * 广播通知没有收件人行，targetCount 恒为 0，管理端无法展示到达率。
     * 这里补充当前用户总数作为分母（一次查询，与页大小无关）。
     * 注意：用户数会随时间增长，因此广播的到达率会随新增用户自然下降——
     * 这是广播语义（对"当时及之后"的全部用户可见）的正确表现，不是统计误差。
     */
    const hasBroadcast = items.some((item) => item.audience === 'all');
    const [userCountRow] = hasBroadcast ? await db.select({ count: sql<number>`count(*)::int` }).from(user) : [{ count: 0 }];
    const broadcastBase = userCountRow?.count ?? 0;

    return {
        items: items.map((item) => {
            const stat = statsMap.get(item.id);
            const isBroadcast = item.audience === 'all';
            return {
                ...item,
                readCount: stat?.readCount ?? 0,
                // 广播用当前用户总数当分母；定向用实际收件人数
                targetCount: isBroadcast ? broadcastBase : (stat?.targetCount ?? 0),
                audienceBase: isBroadcast ? 'all-users' : 'selected',
            };
        }),
        total: totalRow?.count ?? 0,
        page,
        pageSize,
        broadcastBase,
    };
});
