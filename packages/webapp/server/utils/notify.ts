import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { notificationRecipients, notifications } from '../db/schema';
import { db } from './db';

/**
 * 消息通知。
 *
 * 两种受众：
 * - `all`：全员广播。不预先展开收件人（否则每次发全员通知都要写 N 行），
 *   已读状态写入 notification_recipients 的 user 级记录。
 * - `users`：指定用户。创建时展开为收件人记录，未指定到的用户完全不可见。
 *
 * 用户可见集合 = audience='all' 的通知 ∪ 收件人包含自己的通知。
 */

export interface CreateNotificationInput {
    title: string;
    content?: string;
    type?: string;
    level?: string;
    audience?: 'all' | 'users';
    linkUrl?: string;
    createdBy?: string | null;
    userIds?: string[];
}

export async function createNotification(input: CreateNotificationInput): Promise<string> {
    const audience = input.audience === 'users' ? 'users' : 'all';
    const userIds = [...new Set((input.userIds ?? []).filter(Boolean))];
    if (audience === 'users' && !userIds.length) {
        throw createError({ statusCode: 400, statusMessage: '定向推送至少需要选择一个用户' });
    }
    const id = crypto.randomUUID();
    await db.insert(notifications).values({
        id,
        title: input.title,
        content: input.content ?? '',
        type: input.type ?? 'system',
        level: input.level ?? 'info',
        audience,
        linkUrl: input.linkUrl ?? '',
        createdBy: input.createdBy ?? null,
    });
    if (audience === 'users') {
        await db
            .insert(notificationRecipients)
            .values(userIds.map((userId) => ({ id: crypto.randomUUID(), notificationId: id, userId })))
            .onConflictDoNothing();
    }
    return id;
}

export interface ListNotificationsOptions {
    page?: number;
    pageSize?: number;
    onlyUnread?: boolean;
    type?: string;
}

/** 当前用户可见的通知（含已读状态） */
export async function listUserNotifications(userId: string, options: ListNotificationsOptions = {}) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 20), 100);
    const visible = or(eq(notifications.audience, 'all'), eq(notificationRecipients.userId, userId));
    const filters = [visible];
    if (options.onlyUnread) filters.push(isNull(notificationRecipients.readAt));
    if (options.type) filters.push(eq(notifications.type, options.type));
    const where = and(...filters);

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
            readAt: notificationRecipients.readAt,
        })
        .from(notifications)
        .leftJoin(notificationRecipients, and(eq(notificationRecipients.notificationId, notifications.id), eq(notificationRecipients.userId, userId)))
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .leftJoin(notificationRecipients, and(eq(notificationRecipients.notificationId, notifications.id), eq(notificationRecipients.userId, userId)))
        .where(where);

    return {
        items: items.map((row) => ({ ...row, read: row.readAt !== null })),
        total: totalRow?.count ?? 0,
        page,
        pageSize,
    };
}

/** 未读数（角标用；只查 count，不取正文） */
export async function countUnreadNotifications(userId: string): Promise<number> {
    const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .leftJoin(notificationRecipients, and(eq(notificationRecipients.notificationId, notifications.id), eq(notificationRecipients.userId, userId)))
        .where(and(or(eq(notifications.audience, 'all'), eq(notificationRecipients.userId, userId)), isNull(notificationRecipients.readAt)));
    return row?.count ?? 0;
}

/**
 * 标记已读。
 * - 传入 ids：只标记这些通知
 * - 不传：标记当前用户全部未读（上限 500 条，避免一次写入过多）
 * 广播通知按 (notificationId, userId) upsert，定向通知复用已有收件人行。
 */
export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
    const targets = ids?.length
        ? ids
        : (
              await db
                  .select({ id: notifications.id })
                  .from(notifications)
                  .leftJoin(notificationRecipients, and(eq(notificationRecipients.notificationId, notifications.id), eq(notificationRecipients.userId, userId)))
                  .where(and(or(eq(notifications.audience, 'all'), eq(notificationRecipients.userId, userId)), isNull(notificationRecipients.readAt)))
                  .orderBy(desc(notifications.createdAt))
                  .limit(500)
          ).map((row) => row.id);

    if (!targets.length) return 0;

    const now = new Date();
    await db
        .insert(notificationRecipients)
        .values(targets.map((notificationId) => ({ id: crypto.randomUUID(), notificationId, userId, readAt: now })))
        .onConflictDoUpdate({
            target: [notificationRecipients.notificationId, notificationRecipients.userId],
            set: { readAt: now },
        });
    return targets.length;
}

/** 管理端统计：已读 / 未读人数（广播通知按已读记录数统计） */
export async function notificationReadStats(notificationId: string) {
    const [readRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notificationRecipients)
        .where(and(eq(notificationRecipients.notificationId, notificationId), sql`${notificationRecipients.readAt} is not null`));
    const [targetRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notificationRecipients)
        .where(eq(notificationRecipients.notificationId, notificationId));
    return { readCount: readRow?.count ?? 0, targetCount: targetRow?.count ?? 0 };
}

/** 删除通知（收件人记录级联删除） */
export async function deleteNotification(id: string): Promise<void> {
    await db.delete(notifications).where(eq(notifications.id, id));
}

/** 定向推送时的用户名校验：返回真实存在的用户 id */
export async function filterExistingUserIds(userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];
    const { user } = await import('../db/schema');
    const rows = await db.select({ id: user.id }).from(user).where(inArray(user.id, userIds));
    return rows.map((row) => row.id);
}
