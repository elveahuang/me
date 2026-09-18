import type { H3Event } from 'h3';
import { auth } from './auth';

export async function requireUser(event: H3Event) {
    const session = await auth.api.getSession({ headers: event.headers });
    if (!session) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
    }
    // better-auth 的 getSession 不会因 banned 字段拒绝会话（只有 admin 插件的内部接口会检查），
    // 这里补上：被封禁且封禁未过期的用户不得访问任何 requireUser 链路（含额度消耗）。
    const user = session.user as { banned?: boolean | null; banExpires?: Date | string | null };
    if (user.banned) {
        const expiresAt = user.banExpires ? new Date(user.banExpires).getTime() : null;
        const stillBanned = expiresAt === null || Number.isNaN(expiresAt) || expiresAt > Date.now();
        if (stillBanned) {
            throw createError({ statusCode: 403, statusMessage: '账号已被封禁' });
        }
    }
    return session;
}

export async function requireAdmin(event: H3Event) {
    const session = await requireUser(event);
    if (session.user.role !== 'admin') {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }
    return session;
}
