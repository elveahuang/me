#!/usr/bin/env node
/**
 * 生成部署用的 deploy/.env。
 *
 * 用法：
 *   node deploy/init-env.mjs          # 不存在时创建
 *   node deploy/init-env.mjs --force  # 覆盖重建（会换掉数据库口令与签名密钥）
 *
 * 为什么不覆盖已有文件：
 * PostgreSQL 只在首次初始化数据卷时设置口令，覆盖 .env 后数据库口令不会跟着变，
 * 应用会连不上；BETTER_AUTH_SECRET 更换则会让所有已登录会话失效。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '.env');
const force = process.argv.includes('--force');

/** 生成 URL 与 shell 均安全的随机串（base64url 不含 + / =） */
function secret(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
}

if (existsSync(envPath) && !force) {
    console.log('deploy/.env 已存在，未做修改（如需重建请加 --force，注意会更换数据库口令与签名密钥）');
    process.exit(0);
}

const values = {
    POSTGRES_USER: 'ee',
    POSTGRES_PASSWORD: secret(24),
    POSTGRES_DB: 'ee',
    REDIS_PASSWORD: secret(24),
    BETTER_AUTH_SECRET: secret(32),
    BETTER_AUTH_URL: 'http://localhost:3000',
    ADMIN_INITIAL_PASSWORD: secret(18),
    APP_PORT: '3000',
    RUSTFS_ACCESS_KEY: 'eeadmin',
    RUSTFS_SECRET_KEY: secret(24),
    RUSTFS_BUCKET: 'ee-uploads',
};

const lines = [
    '# 由 deploy/init-env.mjs 生成 —— 含真实密钥，请勿提交到版本库',
    '# 重新生成会更换数据库口令与签名密钥，导致现有会话失效',
    '',
    '# ---- 必填：数据库 ----',
    `POSTGRES_USER=${values.POSTGRES_USER}`,
    `POSTGRES_PASSWORD=${values.POSTGRES_PASSWORD}`,
    `POSTGRES_DB=${values.POSTGRES_DB}`,
    '',
    '# ---- 必填：认证 ----',
    '# 对外访问地址，必须与实际访问域名/端口一致（改端口或加反向代理时同步修改）',
    `BETTER_AUTH_URL=${values.BETTER_AUTH_URL}`,
    `BETTER_AUTH_SECRET=${values.BETTER_AUTH_SECRET}`,
    '# 管理员初始口令：用于创建管理员账号（见 deploy.md「初始化管理员」）',
    `ADMIN_INITIAL_PASSWORD=${values.ADMIN_INITIAL_PASSWORD}`,
    '',
    '# ---- 必填：限流与缓存 ----',
    `REDIS_PASSWORD=${values.REDIS_PASSWORD}`,
    '',
    '# ---- 可选：服务端口 ----',
    `APP_PORT=${values.APP_PORT}`,
    '',
    '# ---- 可选：对象存储（--profile storage 时生效） ----',
    `RUSTFS_ACCESS_KEY=${values.RUSTFS_ACCESS_KEY}`,
    `RUSTFS_SECRET_KEY=${values.RUSTFS_SECRET_KEY}`,
    `RUSTFS_BUCKET=${values.RUSTFS_BUCKET}`,
    '',
    '# ---- 可选：模型供应商（也可稍后在管理后台配置） ----',
    'NUXT_DEEPSEEK_API_KEY=',
    '',
    '# ---- 可选：跨域与出站策略 ----',
    'CORS_ORIGINS=',
    'ALLOW_PRIVATE_OUTBOUND=false',
    '',
    '# ---- 可选：微信登录与支付 ----',
    'WECHAT_OAUTH_APP_ID=',
    'WECHAT_OAUTH_APP_SECRET=',
    'WECHAT_PAY_APP_ID=',
    'WECHAT_PAY_MCH_ID=',
    'WECHAT_PAY_API_KEY=',
    'MOCK_PAY_ENABLED=false',
    '',
];

writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });

console.log('已生成 deploy/.env：');
console.log(`  数据库口令      POSTGRES_PASSWORD=${values.POSTGRES_PASSWORD.slice(0, 6)}…（已随机生成）`);
console.log(`  会话签名密钥    BETTER_AUTH_SECRET=${values.BETTER_AUTH_SECRET.slice(0, 6)}…（已随机生成）`);
console.log(`  管理员初始口令  ADMIN_INITIAL_PASSWORD=${values.ADMIN_INITIAL_PASSWORD}`);
console.log('  管理员初始口令仅在此处显示一次，请先记录；后续可在 deploy/.env 中查看或修改。');
console.log('');
console.log('下一步：docker compose -f deploy/compose.yaml up -d --build');

// 读取一次以确保文件可读，避免权限问题被忽略
readFileSync(envPath);
