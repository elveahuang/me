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
            return memoryRateLimit(key, limit, windowMs);
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
            return {
                ok: false,
                retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
            };
        }

        return { ok: true, retryAfterSec: 0 };
    } catch (err) {
        console.warn(`[rate-limit] Redis 限流操作异常，自动降级内存限流:`, (err as Error)?.message);
        return memoryRateLimit(key, limit, windowMs);
    }
}
