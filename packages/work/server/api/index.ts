import { throwApiNotFound } from '../utils/api-not-found';

/**
 * `/api` 与 `/api/` 根：radix3 的 `**` 要求通配段至少有一个字符，所以同目录的 `[...unmatched].ts`
 * 匹配不到根路径，这类请求原本会掉进页面渲染器变成 500。
 * `GET /api/notes/..` 这类会被 URL 规范化成 `/api/` 的输入也走这里。
 */
export default defineEventHandler((event) => throwApiNotFound(event));
