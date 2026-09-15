import { listPlans } from '../../utils/billing';
import { requireAdmin } from '../../utils/guard';

/** 管理端套餐列表（含已下架） */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    return await listPlans(true);
});
