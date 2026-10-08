import { assertUserId, normalizeBanReason, performUserAction } from '../../../../utils/admin-user-action';
import { requireAdmin } from '../../../../utils/guard';
import { requireMethod } from '../../../../utils/method';

const ROLES = ['admin', 'editor', 'user'];
const ACTIONS = ['set-role', 'ban', 'unban'] as const;

export default defineEventHandler(async (event) => {
    const session = await requireAdmin(event);
    // 该端点没有 `[id].ts` 那种 DELETE 分支，原本任何方法带 body 都会执行改角色/封禁动作
    requireMethod(event, ['POST']);
    const body = (await readBody(event)) ?? {};
    const { action } = body;
    if (!body.userId || !ACTIONS.includes(action)) {
        throw createError({ statusCode: 400, statusMessage: 'userId 与 action 必填' });
    }
    const userId = assertUserId(body.userId);

    // 防止管理员把自己封禁 / 降权导致后台再也进不去
    if (userId === session.user.id && action !== 'unban') {
        throw createError({ statusCode: 400, statusMessage: '不能对自己执行该操作，请让其他管理员处理' });
    }

    if (action === 'set-role' && (!body.role || !ROLES.includes(body.role))) {
        throw createError({ statusCode: 400, statusMessage: 'role 不合法' });
    }

    await performUserAction(event.headers, userId, action, { role: body.role, banReason: normalizeBanReason(body.banReason) });
    return { ok: true };
});
