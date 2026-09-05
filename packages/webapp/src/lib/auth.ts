import { db } from '@/db';
import { account, session, user, verification } from '@/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, bearer } from 'better-auth/plugins';
import { tanstackStartCookies } from 'better-auth/tanstack-start';

export const auth = betterAuth({
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    trustedOrigins: [
        'http://localhost:3000',
        'http://localhost:5173',
        // Ionic/Capacitor（mobile 包）开发服务器
        'http://localhost:8100',
        'capacitor://localhost',
    ],
    advanced: {
        // better-auth 1.7 对所有 POST 强制 Origin 校验，会拒绝非浏览器客户端
        // （mobile / wap / curl 不携带 Origin）。这里显式关闭它：
        // - 浏览器端 CSRF 由 SameSite=Lax 的 session cookie 兜底
        // - 跨域浏览器访问由 /api 路由的 CORS 中间件控制
        disableOriginCheck: true,
        disableCSRFCheck: true,
    },
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema: { user, session, account, verification },
    }),
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        // `admin` 提供用户角色（user.role）与封禁能力
        admin(),
        // `bearer` 允许移动端用 `Authorization: Bearer <token>` 携带会话
        bearer(),
        // 让 better-auth 在 TanStack Start 中正确写入 Cookie（必须放在最后）
        tanstackStartCookies(),
    ],
});
