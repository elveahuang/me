import { listPlans } from '../utils/billing';
import { requireUser } from '../utils/guard';
import { listPaymentProviders } from '../utils/payments';

/** 会员套餐列表（用户侧，登录后可见） */
export default defineEventHandler(async (event) => {
    await requireUser(event);
    const plans = await listPlans(false);
    return { plans, providers: listPaymentProviders() };
});
