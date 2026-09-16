import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, bearer } from 'better-auth/plugins';
import { db } from './db';

export const auth = betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    secret: process.env.BETTER_AUTH_SECRET || 'ee-platform-secret-build-fallback-key-32ch',
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    trustedOrigins: trustedOrigins(),
    advanced: {
        // better-auth 1.7 对所有 POST 强制 Origin 校验，会拒绝移动端 / 非浏览器客户端
        // （它们不携带 Origin）。显式关闭：
        // - 浏览器端 CSRF 由 SameSite=Lax 的 session cookie 兜底
        // - 跨域访问由 trustedOrigins 与部署层反向代理控制
        disableOriginCheck: true,
        disableCSRFCheck: true,
    },
    emailAndPassword: {
        enabled: true,
    },
    rateLimit: {
        enabled: true,
        window: 60,
        max: 100,
        // 覆盖内置的 /sign-in/email 3次/10s 严格规则，防暴力尝试同时容纳冒烟测试
        customRules: {
            '/sign-in/email': { window: 60, max: 20 },
            '/sign-up/email': { window: 60, max: 20 },
        },
    },
    plugins: [admin(), bearer()],
});

/**
 * 受信来源：CORS_ORIGINS（逗号分隔）+ BETTER_AUTH_URL + 本地开发与原生壳默认地址。
 * 新增部署域名只需要配置环境变量，不必改代码。
 */
function trustedOrigins(): string[] {
    const fromEnv = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const base = process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL.replace(/\/+$/, '')] : [];
    return [
        ...new Set([
            ...fromEnv,
            ...base,
            'http://localhost:3000',
            'http://localhost:4173',
            'http://localhost:5173', // mobile dev server
            'capacitor://localhost', // iOS 原生壳
            'https://localhost', // Android 原生壳
        ]),
    ];
}
