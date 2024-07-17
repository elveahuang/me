import { isEqual } from 'radash';

declare type Environment = {
    /**
     * 环境名称
     */
    mode: string;
    /**
     * 开发调试
     */
    debug: boolean;
    /**
     * 服务器
     */
    http: {
        host: string;
        port: number;
    };
    /**
     * 数据库
     */
    database: {
        host: string;
        port: number;
        database: string;
        username: string;
        password: string;
    };
    /**
     * JWT
     */
    jwt: {
        secret: string;
        accessTokenExpire: number;
        refreshTokenExpire: number;
    };
};

export const loadEnv = (): Environment => {
    return {
        mode: process.env.MODE || 'development',
        debug: isEqual(process.env.DEBUG, 'true'),
        http: {
            host: process.env.HOST || '127.0.0.1',
            port: parseInt(process.env.PORT) || 3000,
        },
        database: {
            host: process.env.DB_HOST || '127.0.0.1',
            port: parseInt(process.env.DB_PORT) || 3306,
            database: process.env.DB_NAME || 'lite',
            username: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'root',
        },
        jwt: {
            secret: process.env.JWT_SECRET || '',
            accessTokenExpire: parseInt(process.env.JWT_ACCESS_TOKEN_EXPIRE) || 60,
            refreshTokenExpire: parseInt(process.env.JWT_REFRESH_TOKEN_EXPIRE) || 60,
        },
    };
};
