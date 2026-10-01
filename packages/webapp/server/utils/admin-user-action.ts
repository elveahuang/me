import { auth } from './auth';

/**
 * better-auth 的 userId 是 text 主键，且 admin 插件里所有目标用户都直接进 SQL。
 * 非字符串（`{}`、数组、数字）会让内部适配层把原值当参数抛出去，最终变成 500 + SQL 细节外泄；
 * 这里按仓库既有口径（`chat.post.ts` 的 UUID 校验）先关进单一路径段。
 */
const USER_ID_RE = /^[0-9a-f-]{36}$/i;
/** `bans.banReason` 也是 text 列：不封顶时一条超长封禁理由同样是 22001 + SQL 细节 */
const BAN_REASON_MAX_CHARS = 200;

/**
 * better-auth 的 `auth.api.*` 在直接调用（不走 HTTP handler）时出错一律 **抛 APIError**
 * ——见其 dispatch：非 asResponse 分支会把 APIError 原样 throw。
 * 这些错误本身带着正确的业务语义（用户不存在 404、无权操作 403、不能移除自己 400），
 * 但原样冲出 Nitro handler 会被折成 500：管理端把「你不能删除自己」读成服务器故障，
 * 监控里也全是本不该出现的 5xx。这里只翻译状态码与文案，不吞错误。
 */
async function callAuthApi<T>(run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        const apiError = error as { name?: string; statusCode?: number; body?: { message?: string } };
        if (apiError?.name === 'APIError') {
            const status = typeof apiError.statusCode === 'number' && apiError.statusCode >= 400 && apiError.statusCode < 600 ? apiError.statusCode : 500;
            throw createError({ statusCode: status, statusMessage: apiError.body?.message || '认证服务拒绝了该操作' });
        }
        throw error;
    }
}

export function assertUserId(raw: unknown): string {
    if (typeof raw !== 'string' || !USER_ID_RE.test(raw)) {
        throw createError({ statusCode: 400, statusMessage: 'userId 格式不合法' });
    }
    return raw;
}

/** 封禁理由可选：留空/非字符串一律视为没有理由，超长直接截断（这是给人看的备注，不是账本） */
export function normalizeBanReason(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, BAN_REASON_MAX_CHARS);
}

/** 管理员对某个用户执行改角色 / 封禁 / 解封 */
export async function performUserAction(
    headers: HeadersInit,
    userId: string,
    action: 'set-role' | 'ban' | 'unban',
    extra: { role?: string; banReason?: string } = {},
): Promise<void> {
    switch (action) {
        case 'set-role': {
            // 生成的类型里 role 只有内置的 user/admin（better-auth 未配置 roles 时连枚举校验都不做），
            // 而本项目在管理端开放了 editor；取值已由 handler 的 ROLES 白名单挡住，这里只做类型断言。
            await callAuthApi(() => auth.api.setRole({ body: { userId, role: extra.role as 'user' | 'admin' }, headers }));
            break;
        }
        case 'ban': {
            await callAuthApi(() => auth.api.banUser({ body: { userId, banReason: extra.banReason }, headers }));
            break;
        }
        case 'unban': {
            await callAuthApi(() => auth.api.unbanUser({ body: { userId }, headers }));
            break;
        }
        default:
            throw createError({ statusCode: 400, statusMessage: 'action 不合法' });
    }
}

/**
 * 删除用户。better-auth 自带「不能移除自己」的判断并抛 APIError，
 * 翻译后管理端看到的是 400 与那句原文，而不是一台 500 的服务器。
 */
export async function removeAuthUser(headers: HeadersInit, userId: string): Promise<void> {
    await callAuthApi(() => auth.api.removeUser({ body: { userId }, headers }));
}

export async function banUser(headers: HeadersInit, userId: string, banReason: string | undefined): Promise<void> {
    await callAuthApi(() => auth.api.banUser({ body: { userId, banReason }, headers }));
}

export async function unbanUser(headers: HeadersInit, userId: string): Promise<void> {
    await callAuthApi(() => auth.api.unbanUser({ body: { userId }, headers }));
}

export async function removeUser(headers: HeadersInit, userId: string): Promise<void> {
    await callAuthApi(() => auth.api.removeUser({ body: { userId }, headers }));
}
