import type { NotificationsResponse } from '@commons/contract';
import { requireUser } from '../utils/guard';
import { countUnreadNotifications, listUserNotifications } from '../utils/notify';
import { intParam } from '../utils/query';

/**
 * 用户端通知列表。
 * 支持 ?unread=1 只看未读、?type= 按类型过滤、?page/?pageSize 分页。
 * 返回值中的 unread 字段供导航角标使用，避免再发一次请求。
 *
 * 返回值 satisfies 契约（import type 编译期擦除，不触碰 server 运行时边界）：
 * Date 字段显式转 ISO——线上形状本就是 JSON 序列化结果，这里把类型改成真话。
 */
export default defineEventHandler(async (event): Promise<NotificationsResponse> => {
    const session = await requireUser(event);
    const query = getQuery(event);
    const page = intParam(query.page, 1, 1, 1e6);
    const pageSize = intParam(query.pageSize, 20, 1, 100);
    const onlyUnread = query.unread === '1' || query.unread === 'true';
    const type = typeof query.type === 'string' && query.type && query.type !== 'all' ? query.type : undefined;

    // 列表与未读计数互不依赖，并发查询；unread 供角标复用同一次响应，省一次前端往返。
    const [result, unread] = await Promise.all([
        listUserNotifications(session.user.id, { page, pageSize, onlyUnread, type }),
        countUnreadNotifications(session.user.id),
    ]);

    return {
        items: result.items.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            readAt: row.readAt ? row.readAt.toISOString() : null,
        })),
        total: result.total,
        unread,
        page: result.page,
        pageSize: result.pageSize,
    };
});
