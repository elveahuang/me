import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, bearer } from 'better-auth/plugins';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { db } from '@/db';
import { account, session, user, verification } from '@/db/schema';

export const auth = betterAuth({
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
