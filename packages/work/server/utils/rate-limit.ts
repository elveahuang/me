import { getRedisClient } from './redis';

/**
 * 分布式滑动窗口限流：
 * 优先采用 Redis Lua 脚本原子执行 Sorted Set（ZSET）滑窗算法；
 * 单次网络往返完成清理、计数与写入，彻底避免并发竞态击穿；
 * 当 Redis 未配置或离线时，自动无缝降级为进程内内存滑窗算法。
 */

export interface RateLimitResult {
    ok: boolean;
    retryAfterSec: number;
}

/**
 * 限流指标（P4）。
 *
 * 只按 key 的第一段聚合（`export` / `chat` / `kb-reindex`），不按完整 key：
 * 完整 key 里有知识库 id、排期 id，几千个实体就是几千个基数，指标本身会变成内存泄漏。
 * 进程内、重启清零；Redis 模式下由 Lua 返回的结果记账，不额外发一次网络请求。
 */
export interface RateLimitFamilyMetric {
    family: string;
    calls: number;
    allowed: number;
    blocked: number;
    memoryFallback: number;
    redisErrors: number;
}

const rateLimitMetrics = {
    calls: 0,
    allowed: 0,
    blocked: 0,
    memoryFallback: 0,
    redisErrors: 0,
    families: new Map<string, RateLimitFamilyMetric>(),
};
const MAX_METRIC_FAMILIES = 200;

function metricFamily(key: string): string {
    return key.split(':')[0]?.trim() || 'other';
}

function bucketFor(key: string): RateLimitFamilyMetric {
    let family = metricFamily(key);
    let bucket = rateLimitMetrics.families.get(family);
    if (bucket) return bucket;
    if (rateLimitMetrics.families.size >= MAX_METRIC_FAMILIES) {
        bucket = rateLimitMetrics.families.get('other');
        if (bucket) return bucket;
        family = 'other';
    }
    bucket = { family, calls: 0, allowed: 0, blocked: 0, memoryFallback: 0, redisErrors: 0 };
    rateLimitMetrics.families.set(family, bucket);
    return bucket;
}

function recordRateLimit(key: string, result: RateLimitResult, memory: boolean): void {
    rateLimitMetrics.calls += 1;
    if (result.ok) rateLimitMetrics.allowed += 1;
    else rateLimitMetrics.blocked += 1;
    if (memory) rateLimitMetrics.memoryFallback += 1;

    const bucket = bucketFor(key);
    bucket.calls += 1;
    if (result.ok) bucket.allowed += 1;
    else bucket.blocked += 1;
    if (memory) bucket.memoryFallback += 1;
}

function recordRedisError(key: string): void {
    rateLimitMetrics.redisErrors += 1;
    bucketFor(key).redisErrors += 1;
}

/** 只读快照；families 按调用量降序，便于直接看出哪条入口被刷。 */
export function getRateLimitMetrics(): Omit<RateLimitFamilyMetric, 'family'> & { families: RateLimitFamilyMetric[] } {
    const { families, ...totals } = rateLimitMetrics;
    return { ...totals, families: [...families.values()].sort((a, b) => b.calls - a.calls) };
}

/** 只给测试用：清空进程内计数，避免上一条断言污染下一条。 */
export function resetRateLimitMetrics(): void {
    rateLimitMetrics.calls = 0;
    rateLimitMetrics.allowed = 0;
    rateLimitMetrics.blocked = 0;
    rateLimitMetrics.memoryFallback = 0;
    rateLimitMetrics.redisErrors = 0;
    rateLimitMetrics.families.clear();
}

// 内存滑窗降级存储
const memoryBuckets = new Map<string, number[]>();
const MAX_MEMORY_BUCKETS = 10_000;

function memoryRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    let timestamps = memoryBuckets.get(key);
    if (timestamps) {
        timestamps = timestamps.filter((t) => now - t < windowMs);
    } else {
        timestamps = [];
        if (memoryBuckets.size >= MAX_MEMORY_BUCKETS) {
            for (const [k, v] of memoryBuckets) {
                if (v.every((t) => now - t >= windowMs)) memoryBuckets.delete(k);
            }
            if (memoryBuckets.size >= MAX_MEMORY_BUCKETS) memoryBuckets.clear();
        }
    }

    if (timestamps.length >= limit) {
        memoryBuckets.set(key, timestamps);
        const retryAfterMs = windowMs - (now - (timestamps[0] ?? now));
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    timestamps.push(now);
    memoryBuckets.set(key, timestamps);
    return { ok: true, retryAfterSec: 0 };
}

/**
 * Redis 原子滑动窗口 Lua 脚本：
 * KEYS[1]: 限流 key
 * ARGV[1]: 当前时间戳 (ms)
 * ARGV[2]: 窗口起始时间戳 (ms)
 * ARGV[3]: 限制次数 (limit)
 * ARGV[4]: key 过期时间 (ttl ms)
 * ARGV[5]: 当前请求唯一 member 标识
 *
 * 返回 [1, ''] 表示通过；[0, oldestMember] 表示超限并返回最早记录用于计算 retry-after
 */
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowStart = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local member = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
local currentCount = redis.call('ZCARD', key)
if currentCount >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0)
    return {0, oldest[1] or ''}
else
    redis.call('ZADD', key, now, member)
    redis.call('PEXPIRE', key, ttl)
    return {1, ''}
end
`;

/**
 * 滑动窗口限流
 * @param key 标识符（如 `chat:${userId}`）
 * @param limit 窗口内最大请求次数
 * @param windowMs 窗口大小（毫秒）
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    try {
        const client = await getRedisClient();
        if (!client) {
            const result = memoryRateLimit(key, limit, windowMs);
            recordRateLimit(key, result, true);
            return result;
        }

        const now = Date.now();
        const windowStart = now - windowMs;
        const redisKey = `rl:${key}`;
        const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

        const result = (await client.eval(RATE_LIMIT_LUA, {
            keys: [redisKey],
            arguments: [String(now), String(windowStart), String(limit), String(windowMs * 2), member],
        })) as [number, string];

        const allowed = Number(result?.[0]) === 1;
        if (!allowed) {
            const oldestMember = result?.[1];
            const parsedTime = oldestMember ? Number(oldestMember.split(':')[0]) : windowStart;
            const oldestTime = Number.isNaN(parsedTime) ? windowStart : parsedTime;
            const retryAfterMs = Math.max(1000, windowMs - (now - oldestTime));
            const blocked = {
                ok: false,
                retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
            };
            recordRateLimit(key, blocked, false);
            return blocked;
        }

        const passed = { ok: true, retryAfterSec: 0 };
        recordRateLimit(key, passed, false);
        return passed;
    } catch (err) {
        console.warn(`[rate-limit] Redis 限流操作异常，自动降级内存限流:`, (err as Error)?.message);
        recordRedisError(key);
        const result = memoryRateLimit(key, limit, windowMs);
        recordRateLimit(key, result, true);
        return result;
    }
}
