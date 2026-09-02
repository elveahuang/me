/**
 * 简单的内存滑动窗口限流（单实例部署足够；多实例部署时应换成共享存储）。
 */

interface RateLimitResult {
    ok: boolean;
    retryAfterSec: number;
}

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    let timestamps = buckets.get(key);
    if (timestamps) {
        timestamps = timestamps.filter((t) => now - t < windowMs);
    } else {
        timestamps = [];
        if (buckets.size >= MAX_BUCKETS) {
            // 防止内存无限膨胀：先清掉已过期的桶
            for (const [k, v] of buckets) {
                if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
            }
            if (buckets.size >= MAX_BUCKETS) buckets.clear();
        }
    }

    if (timestamps.length >= limit) {
        buckets.set(key, timestamps);
        const retryAfterMs = windowMs - (now - (timestamps[0] ?? now));
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    timestamps.push(now);
    buckets.set(key, timestamps);
    return { ok: true, retryAfterSec: 0 };
}
