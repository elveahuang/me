import { expireStaleMemberships, getMembershipStatus } from '../../utils/billing';
import { requireUser } from '../../utils/guard';

/** 当前用户会员状态（套餐、到期时间、当日配额与用量） */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    await expireStaleMemberships(session.user.id);
    return await getMembershipStatus(session.user.id);
});
