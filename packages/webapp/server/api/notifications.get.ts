import { requireUser } from '../utils/guard';
import { countUnreadNotifications, listUserNotifications } from '../utils/notify';

/**
 * 用户端通知列表。
 * 支持 ?unread=1 只看未读、?type= 按类型过滤、?page/?pageSize 分页。
 * 返回值中的 unread 字段供导航角标使用，避免再发一次请求。
 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const query = getQuery(event);
    const page = Math.min(Math.max(1, Math.floor(Number(query.page)) || 1), 1e6); // 上界夹逼并取整：?page=Infinity/小数/超大值会让 offset 溢出或非整数而被 PG 拒绝
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 20), 100);
    const onlyUnread = query.unread === '1' || query.unread === 'true';
    const type = typeof query.type === 'string' && query.type && query.type !== 'all' ? query.type : undefined;

    // 列表与未读计数互不依赖，并发查询；unread 供角标复用同一次响应，省一次前端往返。
    const [result, unread] = await Promise.all([
        listUserNotifications(session.user.id, { page, pageSize, onlyUnread, type }),
        countUnreadNotifications(session.user.id),
    ]);

    return { ...result, unread };
});
