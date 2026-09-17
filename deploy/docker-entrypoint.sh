#!/bin/sh
# 容器入口：先应用数据库迁移，再启动服务。
#
# 迁移是幂等的（已应用的版本会跳过），因此每次启动都执行是安全的；
# 这样升级镜像时无需额外的运维步骤，也不会出现「新代码跑旧表结构」。
set -e

if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
    attempt=1
    max_attempts="${MIGRATE_MAX_ATTEMPTS:-30}"

    until node /app/output/server/migrate.mjs; do
        if [ "$attempt" -ge "$max_attempts" ]; then
            echo "[entrypoint] 数据库在 ${max_attempts} 次尝试后仍不可用，终止启动" >&2
            exit 1
        fi
        echo "[entrypoint] 等待数据库就绪…（第 ${attempt}/${max_attempts} 次重试）" >&2
        attempt=$((attempt + 1))
        sleep 2
    done
else
    echo "[entrypoint] MIGRATE_ON_START=false，跳过迁移"
fi

echo "[entrypoint] 启动 Web/API 服务，端口 ${NITRO_PORT:-3000}"
exec node /app/output/server/index.mjs
