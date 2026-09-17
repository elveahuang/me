import { requireUser } from '../../utils/guard';
import { countUnreadNotifications, markNotificationsRead } from '../../utils/notify';

/**
 * 标记通知已读。
 * body 传 `{ ids: [...] }` 标记指定通知；不传 ids 则把当前用户全部未读标记为已读。
 * 返回剩余未读数，前端可直接更新角标而无需再次请求。
 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const body = (await readBody(event).catch(() => ({}))) ?? {};
    const ids = Array.isArray(body.ids) ? body.ids.map((v: unknown) => String(v)).filter(Boolean) : undefined;

    const updated = await markNotificationsRead(session.user.id, ids);
    const unread = await countUnreadNotifications(session.user.id);
    return { ok: true, updated, unread };
});
