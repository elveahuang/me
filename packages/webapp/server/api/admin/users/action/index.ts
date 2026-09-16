import { auth } from '../../../../utils/auth';
import { requireAdmin } from '../../../../utils/guard';

const ROLES = ['admin', 'editor', 'user'];

export default defineEventHandler(async (event) => {
    const session = await requireAdmin(event);
    const body = await readBody(event);
    const { userId, action } = body;
    if (!userId || !['set-role', 'ban', 'unban'].includes(action)) {
        throw createError({ statusCode: 400, statusMessage: 'userId and valid action are required' });
    }

    // 防止管理员把自己封禁 / 降权导致后台再也进不去
    if (userId === session.user.id && action !== 'unban') {
        throw createError({ statusCode: 400, statusMessage: '不能对自己执行该操作，请让其他管理员处理' });
    }

    switch (action) {
        case 'set-role': {
            if (!body.role || !ROLES.includes(body.role)) {
                throw createError({ statusCode: 400, statusMessage: 'valid role is required' });
            }
            await auth.api.setRole({ body: { userId, role: body.role }, headers: event.headers });
            break;
        }
        case 'ban':
            await auth.api.banUser({ body: { userId, banReason: body.banReason }, headers: event.headers });
            break;
        case 'unban':
            await auth.api.unbanUser({ body: { userId }, headers: event.headers });
            break;
    }
    return { ok: true };
});
