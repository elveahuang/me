import { createError, type H3Event } from 'h3';

/**
 * 未命中的 `/api/**` 统一回 404 JSON，而不是掉进 Nuxt 的 SSR 渲染器。
 *
 * 存在理由：Nitro 匹配不到任何 handler 时，请求会落到页面渲染器 `/**`，报的是
 * `Either manifest or precomputed data must be provided` 这种 500（dev 下还连带 stack 一起回给客户端）。
 * 对界面来说它既不是「接口不存在」也不是「方法不支持」，一次拼错的 URL 就表现成「服务器坏了」，
 * 而真正的问题只是路由表里没有这条。
 *
 * 两个消费者：`api/[...unmatched].ts`（任意子路径）与 `api/index.ts`（`/api` 与 `/api/` 根，
 * radix3 的 `**` 要求通配段至少有一个字节，所以根路径必须由 index 单独兜住）。
 */
export function throwApiNotFound(event: H3Event): never {
    const path = event.path.split('?')[0];
    throw createError({ statusCode: 404, statusMessage: `接口不存在：${event.method} ${path}` });
}

/**
 * DELETE 按 id 命中 0 行时抛 404。
 *
 * 0 行影响也要报出来：否则 id 抄错或行已被另一个管理员删掉时，界面照样提示「已删除」。
 * `delete(...).returning({ id })` 的结果直接交给它；带引用检查/事务的删除（如 agents）
 * 有自己的 404 判定位置，不经过这里。
 */
export function assertDeleted(deleted: ReadonlyArray<{ id: string }>, label: string): void {
    if (!deleted.length) throw createError({ statusCode: 404, statusMessage: `${label}不存在` });
}
