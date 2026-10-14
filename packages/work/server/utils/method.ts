import type { H3Event } from 'h3';

/**
 * 限定事件处理只接受给定方法，其余一律 405。
 *
 * 存在理由：一批 `[id].ts` / `action/index.ts` 用「`if (method === 'DELETE') …否则当作更新」的写法，
 * 于是 GET 会落进写分支——读一次就把 `updatedAt` 推进一次（列表排序随之改变），管理端 `users/action`
 * 更是 GET 带 body 就能改角色/封禁用户。方法语义必须显式白名单，不能靠「非 DELETE 即写入」反推。
 */
export function requireMethod(event: H3Event, allowed: string[]) {
    const method = getMethod(event);
    if (!allowed.includes(method)) {
        throw createError({ statusCode: 405, statusMessage: `${method} ${event.path} 不支持，仅允许 ${allowed.join(' / ')}` });
    }
    return method;
}
