/**
 * 创建 / 提升管理员账号（容器内使用）。
 *
 * 为什么不在容器里跑 seed.ts：
 * seed.ts 是 TypeScript，且依赖 Nitro 的自动导入环境（devDependencies 里的 tsx 也不在运行镜像里）。
 * 这里改为复用应用自身的注册接口来创建账号——密码哈希、字段填充都由 better-auth 完成，
 * 与用户在页面上注册的结果完全一致；随后用 SQL 把角色提升为 admin。
 * 这样既不复制认证逻辑，也不依赖开发依赖。
 *
 * 用法（在 app 容器内执行）：
 *   docker compose -f deploy/compose.yaml exec app node /app/output/server/create-admin.mjs
 *   docker compose -f deploy/compose.yaml exec \
 *     -e ADMIN_EMAIL=ops@example.com -e ADMIN_PASSWORD='强口令' \
 *     app node /app/output/server/create-admin.mjs
 *
 * 幂等：账号已存在时只做角色提升；密码不会被覆盖，避免误改线上口令。
 */
import postgres from 'postgres';

const baseUrl = process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.NITRO_PORT || 3000}`;
const email = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD;
const name = process.env.ADMIN_NAME || '系统管理员';

if (!password) {
    console.error('[create-admin] 缺少 ADMIN_PASSWORD（或 ADMIN_INITIAL_PASSWORD）环境变量');
    process.exit(1);
}
if (password.length < 8) {
    console.error('[create-admin] 口令至少 8 位');
    process.exit(1);
}
if (!process.env.POSTGRES_URL) {
    console.error('[create-admin] 缺少 POSTGRES_URL 环境变量');
    process.exit(1);
}

/** 尝试注册；账号已存在时接口会返回错误，这里视为「待提升」而非失败 */
async function ensureAccount() {
    const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
    });
    if (res.ok) return 'created';

    const text = await res.text();
    if (res.status === 422 || /exist/i.test(text)) return 'exists';
    throw new Error(`注册失败（HTTP ${res.status}）：${text.slice(0, 200)}`);
}

let status;
try {
    status = await ensureAccount();
} catch (error) {
    console.error('[create-admin]', error instanceof Error ? error.message : error);
    process.exit(1);
}

const sql = postgres(process.env.POSTGRES_URL, { max: 1, prepare: false });
try {
    const updated = await sql`
        update "user" set role = 'admin', "updated_at" = now()
        where lower(email) = ${email}
        returning id, email, role
    `;
    if (!updated.length) {
        console.error(`[create-admin] 账号 ${email} 未能写入数据库`);
        process.exitCode = 1;
    } else {
        const action = status === 'created' ? '已创建并提升为管理员' : '已存在，已确保为管理员';
        console.log(`[create-admin] ${updated[0].email} ${action}`);
    }
} finally {
    await sql.end({ timeout: 5 });
}
