import type { H3Event } from 'h3';
import { auth } from './auth';
import { ADMIN_BODY_LIMIT_BYTES, readCappedBodyIntoH3Cache } from './request-body';

export async function requireUser(event: H3Event) {
    const session = await auth.api.getSession({ headers: event.headers });
    if (!session) {
        throw createError({ statusCode: 401, statusMessage: '请先登录' });
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

export async function requireAdmin(event: H3Event, options: { bodyLimitBytes?: number } = {}) {
    const session = await requireUser(event);
    if (session.user.role !== 'admin') {
        throw createError({ statusCode: 403, statusMessage: '没有权限执行该操作' });
    }
    // 鉴权通过后才收口读体：未授权的请求在今天是「401 直接返回、正文根本不读」，
    // 把封顶放在鉴权之前会让匿名访客反过来获得「每个连接可让服务端缓冲 1MB」的新额度。
    // 全部管理端 handler 都是 requireAdmin 在前、读体在后，所以这里读到的字节一定会被下游复用
    // （readCappedBodyIntoH3Cache 写回 h3 自己的缓存位，且重复调用幂等）。
    // 只在请求确实声明了正文时才读：既空转掉 GET，也不让「chunked 但一直不写完」的
    // 写请求把 handler 挂在一个根本没有数据的流上。
    const headers = event.node.req.headers;
    const hasBody = headers['transfer-encoding'] !== undefined || Number(headers['content-length']) > 0;
    if (hasBody) {
        await readCappedBodyIntoH3Cache(event, options.bodyLimitBytes ?? ADMIN_BODY_LIMIT_BYTES);
    }
    return session;
}
