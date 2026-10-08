import { requireUser } from '../../utils/guard';
import { countUnreadNotifications } from '../../utils/notify';

/**
 * 未读数（轻量接口，供导航角标轮询）。
 * 只做 count 查询，不返回正文，避免角标刷新拉取整页数据。
 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const unread = await countUnreadNotifications(session.user.id);
    return { unread };
});
