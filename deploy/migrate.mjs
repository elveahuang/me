/**
 * 数据库迁移执行器（部署镜像内使用）。
 *
 * 为什么需要独立脚本：
 * drizzle-kit 只在开发依赖里，生产镜像只装 .output（自包含 50MB，不含 1.9GB 开发依赖）。
 * 而 drizzle-orm 自带的迁移执行器只是两个很小的文件，这里在镜像构建阶段补进 .output，
 * 运行时即可用与 `pnpm webapp:db:migrate` 完全相同的方式应用迁移（同一张 __drizzle_migrations 表）。
 *
 * 幂等：已应用的迁移会跳过，容器每次启动都可安全执行。
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { existsSync } from 'node:fs';
import postgres from 'postgres';

const connectionString = process.env.POSTGRES_URL;
const migrationsFolder = process.env.MIGRATIONS_FOLDER || '/app/migrations';

if (!connectionString) {
    console.error('[migrate] 缺少 POSTGRES_URL 环境变量');
    process.exit(1);
}
if (!existsSync(migrationsFolder)) {
    console.error(`[migrate] 迁移目录不存在: ${migrationsFolder}`);
    process.exit(1);
}

const client = postgres(connectionString, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    // drizzle 每次都会执行 create schema/table if not exists，PostgreSQL 会回 NOTICE；
    // 容器日志里刷这些「already exists, skipping」没有信息量，这里静音。
    onnotice: () => {},
});

try {
    console.log(`[migrate] 开始应用迁移，来源: ${migrationsFolder}`);
    await migrate(drizzle(client), { migrationsFolder });
    console.log('[migrate] 迁移完成');
} catch (error) {
    console.error('[migrate] 迁移失败:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await client.end({ timeout: 5 });
}
