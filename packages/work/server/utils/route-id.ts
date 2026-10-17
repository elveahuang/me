import { createError, getRouterParam, type H3Event } from 'h3';

/**
 * work 里所有主键都由服务端 `crypto.randomUUID()` 生成（含 seed），所以 id 只有这一种合法形状。
 * 路径参数与请求体里的 id 共用同一条规则，避免两侧口径漂开。
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 路径参数 `:id` 的形状闸门，必须在查库之前。
 *
 * 少这一步时 `GET /api/schedules/%00` 会把带 NUL 的串原样交给驱动，PostgreSQL 直接拒绝 `0x00`，
 * 而 drizzle 把整条 `Failed query: select "id", "title", "prompt", ...` 连同列清单一起
 * 写进响应体——一条 URL 就透出全表结构；400 个 `x` 这类段同样是白白多打一次库。
 *
 * 显式 import h3 的理由同其它 utils：`pnpm work:test` 用 tsx 直跑，没有 Nitro 自动导入。
 */
export function routeId(event: H3Event, name = 'id', label = name): string {
    const value = getRouterParam(event, name) ?? '';
    if (!UUID_PATTERN.test(value)) {
        throw createError({ statusCode: 400, statusMessage: `${label}不是合法的 id` });
    }
    return value;
}
