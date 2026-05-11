import env from '@/core/env';
import logger from '@/core/utils/logger';
import { createClient, RedisClientOptions } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;

export class CacheService {
    public async getClient(): Promise<RedisClient> {
        if (client == null) {
            const options: RedisClientOptions = {
                socket: {
                    host: env.redis.host,
                    port: env.redis.port as number,
                },
                database: env.redis.database as number,
                password: env.redis.password,
            };
            client = createClient(options);
            client.on('error', (e: any): void => {
                logger.info(`Get redis client error ${e}`);
            });
            await client.connect();
        }
        return client;
    }

    public async closeClient(): Promise<void> {
        logger.info('CacheService closeClient');
        if (client) {
            try {
                client.destroy();
            } catch (e) {
                logger.info(`Close redis client error.`, e);
            }
        }
    }
}

export function getCacheService(): CacheService {
    return new CacheService();
}
