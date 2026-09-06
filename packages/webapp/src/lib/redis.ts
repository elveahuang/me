import { createClient, type RedisClientType } from 'redis';

/**
 * node-redis 客户端与高层缓存工具层。
 *
 * 具备优雅降级能力：当未配置 REDIS_URL 或 Redis 离线时，
 * 捕获连接异常并自动降级，避免阻塞应用启动与业务运行。
 */

let redisClient: RedisClientType | null = null;
let isConnecting = false;
let lastConnectAttempt = 0;
const CONNECT_COOLDOWN_MS = 10_000; // 失败后 10 秒内不再重复尝试连接，防高频重连拖累请求

function createSafeRedisClient(): RedisClientType {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const client = createClient({
        url,
        socket: {
            connectTimeout: 5000,
            reconnectStrategy: (retries) => {
                // 指数退避，最大间隔 5 秒
                if (retries > 10) {
                    return new Error('Redis 重连次数超限，停止自动重连');
                }
                return Math.min(retries * 500, 5000);
            },
        },
    });

    client.on('error', (err) => {
        // 避免未捕获异常导致 Node 进程退出
        console.warn('[redis] 连接或操作异常 (自动降级生效):', (err as Error)?.message || err);
    });

    client.on('connect', () => {
        console.log('[redis] 正在连接 Redis 服务...');
    });

    client.on('ready', () => {
        console.log('[redis] Redis 客户端已就绪');
    });

    return client as RedisClientType;
}

/** 获取已就绪的 Redis 客户端；如果 Redis 不可用则返回 null */
export async function getRedisClient(): Promise<RedisClientType | null> {
    const now = Date.now();

    if (redisClient?.isReady) {
        return redisClient;
    }

    // 冷却期内不反复尝试握手
    if (now - lastConnectAttempt < CONNECT_COOLDOWN_MS) {
        return null;
    }

    if (isConnecting) {
        return null;
    }

    try {
        isConnecting = true;
        lastConnectAttempt = now;
        if (!redisClient) {
            redisClient = createSafeRedisClient();
        }
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
        return redisClient.isReady ? redisClient : null;
    } catch (err) {
        console.warn('[redis] 连接失败，将降级为内存模式:', (err as Error)?.message || err);
        return null;
    } finally {
        isConnecting = false;
    }
}

/** 检查当前 Redis 是否就绪 */
export function isRedisAvailable(): boolean {
    return Boolean(redisClient?.isReady);
}

/**
 * 读取缓存
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
    try {
        const client = await getRedisClient();
        if (!client) return null;
        const val = await client.get(key);
        if (!val) return null;
        return JSON.parse(val) as T;
    } catch (err) {
        console.warn(`[redis] cacheGet 失败 (${key}):`, (err as Error)?.message);
        return null;
    }
}

/**
 * 设置缓存（支持秒级 TTL）
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
        if (value === undefined) return;
        const serialized = JSON.stringify(value);
        if (serialized === undefined) return;

        const client = await getRedisClient();
        if (!client) return;

        if (ttlSeconds && ttlSeconds > 0) {
            await client.set(key, serialized, { EX: ttlSeconds });
        } else {
            await client.set(key, serialized);
        }
    } catch (err) {
        console.warn(`[redis] cacheSet 失败 (${key}):`, (err as Error)?.message);
    }
}

/**
 * 删除缓存（单条或批量）
 */
export async function cacheDel(keys: string | string[]): Promise<void> {
    try {
        const client = await getRedisClient();
        if (!client) return;
        const list = Array.isArray(keys) ? keys : [keys];
        if (list.length > 0) {
            await client.del(list);
        }
    } catch (err) {
        console.warn(`[redis] cacheDel 失败:`, (err as Error)?.message);
    }
}

/**
 * 带有缓存穿透保护的 Get or Set 辅助函数
 */
export async function cacheGetOrSet<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = await cacheGet<T>(key);
    if (cached !== null && cached !== undefined) {
        return cached;
    }
    const fresh = await fetcher();
    await cacheSet(key, fresh, ttlSeconds);
    return fresh;
}

/**
 * 优雅关闭 Redis 客户端连接
 */
export async function closeRedisClient(): Promise<void> {
    if (redisClient) {
        try {
            if (redisClient.isOpen) {
                await redisClient.quit();
            }
        } catch (err) {
            console.warn('[redis] 关闭连接异常:', (err as Error)?.message || err);
        } finally {
            redisClient = null;
        }
    }
}

// 监听进程终止信号，优雅关闭 Redis 连接
if (typeof process !== 'undefined' && typeof process.on === 'function') {
    const onExit = () => {
        if (redisClient?.isOpen) {
            redisClient.quit().catch(() => {});
            redisClient = null;
        }
    };
    process.once('SIGINT', onExit);
    process.once('SIGTERM', onExit);
}
