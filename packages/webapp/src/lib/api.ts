import { auth } from './auth';
import { corsResponseHeaders } from './cors';
import { isAdminRole } from './session';

/** REST 路由统一 JSON 返回（附带 CORS 头，供 mobile / wap 等跨源客户端使用） */
export function json(data: unknown, status = 200, headers?: HeadersInit) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            ...corsResponseHeaders(),
            ...Object.fromEntries(new Headers(headers)),
        },
    });
}

export class HttpError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

/** 把处理器抛出的异常转换为 JSON 响应 */
export function errorResponse(e: unknown) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('[api] unexpected error:', e);
    return json({ error: '服务器内部错误' }, 500);
}

/** 要求已登录，返回会话；否则抛 401/403 */
export async function requireUser(request: Request) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new HttpError(401, '请先登录');
    if (session.user.banned) throw new HttpError(403, '账号已被封禁');
    return session;
}

/** 要求管理员（user.role 含 admin） */
export async function requireAdmin(request: Request) {
    const session = await requireUser(request);
    if (!isAdminRole(session.user.role)) throw new HttpError(403, '需要管理员权限');
    return session;
}

export async function readJson<T>(request: Request): Promise<T> {
    try {
        return (await request.json()) as T;
    } catch {
        throw new HttpError(400, '请求体不是合法 JSON');
    }
}

export function parseId(value: string | undefined, label = 'ID') {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `无效的${label}`);
    return id;
}
