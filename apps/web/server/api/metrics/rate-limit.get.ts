import { requireMethod } from '../../utils/method';
import { getRateLimitMetrics } from '../../utils/rate-limit';

/**
 * 限流指标（P4）：按入口族聚合的通过/拦截/降级次数。
 *
 * 只读、不经过 `rateLimit()` 本身——否则每次看指标都会给指标加一次计数。
 * 进程内、重启清零；多实例各自一份，不做跨进程聚合（本机单主场景够用）。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    return {
        scope: 'process',
        generatedAt: new Date().toISOString(),
        ...getRateLimitMetrics(),
    };
});
