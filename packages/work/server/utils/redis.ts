import { createClient, type RedisClientType } from 'redis';

/**
 * node-redis 客户端。
 *
 * 具备优雅降级能力：当未配置 REDIS_URL 或 Redis 离线时，
 * 捕获连接异常并自动降级，避免阻塞应用启动与业务运行。
 *
 * 只导出 `getRedisClient()`：限流与 `/api/health` 要的是「有没有这个客户端」，
 * 不是缓存层。本机工作台没有需要跨请求复用的缓存，以前那几个 `cache*` 助手一个消费者都没有。
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
    // 如果没有配置 REDIS_URL，直接走内存模式，不盲目尝试本地无凭证连接
    if (!process.env.REDIS_URL) {
        return null;
    }

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
        if (redisClient) {
            try {
                await redisClient.disconnect();
            } catch {
                // ignore
            }
            redisClient = null;
        }
        return null;
    } finally {
        isConnecting = false;
    }
}

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
