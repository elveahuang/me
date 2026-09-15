import { auth } from '../../../utils/auth';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const userId = getRouterParam(event, 'id')!;
    await auth.api.removeUser({ body: { userId }, headers: event.headers });
    return { ok: true };
});
