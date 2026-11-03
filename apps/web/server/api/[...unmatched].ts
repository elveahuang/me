import { throwApiNotFound } from '../utils/api-not-found';

/**
 * 未命中的 `/api/**` 子路径（`GET /api/definitely-not-a-route`、被删掉的旧接口、拼错的资源名）落到这里。
 * 为什么需要它、以及为什么 `/api` 与 `/api/` 根要由同目录的 `index.ts` 各自兜住，见 `utils/api-not-found.ts`。
 */
export default defineEventHandler((event) => throwApiNotFound(event));
