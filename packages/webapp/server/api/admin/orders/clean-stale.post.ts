import { closeStalePendingOrders } from '../../../utils/billing';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const count = await closeStalePendingOrders();
    return { ok: true, closedCount: count };
});
