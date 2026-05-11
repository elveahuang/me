import { APP_NAME, APP_VERSION } from '@/core/utils/constants';
import { isEqual } from 'es-toolkit';

declare type Environment = {
    app: {
        name: string;
        version: string;
    };
    ai: {
        deepseek: {
            apiKey: string;
        };
        openai: {
            apiKey: string;
            baseURL: string;
        };
    };
    wechat: {
        mp: {
            appId: string;
            appSecret: string;
        };
        ma: {
            appId: string;
            appSecret: string;
        };
    };
    server: {
        app: string;
    };
    redis: {
        host: string;
        port: string | number;
        database: string | number;
        password: string;
    };
    debug: {
        enabled: boolean;
    };
};

export const env: Environment = {
    app: {
        name: process.env.APP_NAME ?? APP_NAME,
        version: process.env.APP_VERSION ?? APP_VERSION,
    },
    server: {
        app: process.env.APP_SERVER ?? '',
    },
    ai: {
        deepseek: {
            apiKey: process.env.APP_AI_DEEPSEEK_API_KEY ?? '',
        },
        openai: {
            apiKey: process.env.APP_AI_OPENAI_API_KEY ?? '',
            baseURL: process.env.APP_AI_OPENAI_BASE_URL ?? '',
        },
    },
    wechat: {
        mp: {
            appId: process.env.APP_WECHAT_MP_APP_ID ?? '',
            appSecret: process.env.APP_WECHAT_MP_APP_SECRET ?? '',
        },
        ma: {
            appId: process.env.APP_WECHAT_MA_APP_ID ?? '',
            appSecret: process.env.APP_WECHAT_MA_APP_SECRET ?? '',
        },
    },
    redis: {
        host: process.env.APP_REDIS_HOST ?? '127.0.0.1',
        port: process.env.APP_REDIS_PORT ?? 6379,
        database: process.env.APP_REDIS_DATABASE ?? 0,
        password: process.env.APP_REDIS_PASSWORD ?? 'redis',
    },
    debug: {
        enabled: isEqual(process.env.APP_DEBUG_ENABLED, 'true'),
    },
};

export default env;
