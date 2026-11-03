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
