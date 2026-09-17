# syntax=docker/dockerfile:1

# ============================================================================
# EE 智能体平台 —— 生产镜像
#
# 两阶段构建：
#   builder：装齐 workspace 依赖并执行 nuxt build
#   runner ：只带 .output（自包含，约 50MB）+ 迁移文件，不带 1.9GB 开发依赖
#
# 构建上下文必须是仓库根目录：
#   docker build -f deploy/Dockerfile -t ee-webapp:latest .
# 直接 `docker compose -f deploy/compose.yaml build` 亦可（compose 已指定 context）。
# ============================================================================

# ---------------------------- 构建阶段 ----------------------------
FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# corepack 按 package.json 的 packageManager 字段安装 pnpm，避免与 CI/本地版本漂移
RUN corepack enable

WORKDIR /src

# 先只拷贝依赖清单：依赖层可在源码变更时复用缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/commons/package.json packages/commons/
COPY packages/config/package.json packages/config/
COPY packages/mobile/package.json packages/mobile/
COPY packages/webapp/package.json packages/webapp/

# 构建脚本会触发 husky 的 prepare，容器内无 .git，husky 会自行跳过
RUN pnpm install --frozen-lockfile

COPY packages ./packages

# 只构建 Web/API（移动端是独立 App，不随服务端镜像发布）
RUN pnpm --filter @repo/webapp build

# drizzle-kit 属于开发依赖，不会进入 .output；而迁移执行器只有两个小文件，
# 这里补齐到 .output，让容器启动时能直接应用迁移（与本地 pnpm webapp:db:migrate 同一张迁移表）
# 注意：pnpm 把依赖放在各包自己的 node_modules 下（软链到 .pnpm store），
# 因此要从 packages/webapp/node_modules 取，而不是仓库根 node_modules。
RUN cp packages/webapp/node_modules/drizzle-orm/migrator.js packages/webapp/.output/server/node_modules/drizzle-orm/ \
    && mkdir -p packages/webapp/.output/server/node_modules/drizzle-orm/postgres-js \
    && cp packages/webapp/node_modules/drizzle-orm/postgres-js/migrator.js packages/webapp/.output/server/node_modules/drizzle-orm/postgres-js/ \
    && test -f packages/webapp/.output/server/node_modules/drizzle-orm/migrator.js

# ---------------------------- 运行阶段 ----------------------------
FROM node:22-bookworm-slim AS runner

# env-guard 在 production 下会拒绝占位符密钥启动，因此这里固定生产模式
ENV NODE_ENV=production
ENV NITRO_PORT=3000
ENV NITRO_HOST=0.0.0.0
ENV MIGRATIONS_FOLDER=/app/migrations

WORKDIR /app

# 迁移与管理脚本放在 .output/server 下：ESM 解析会命中 .output/server/node_modules，
# 从而复用镜像内已有的 drizzle-orm 与 postgres，无需额外安装依赖
COPY --from=builder /src/packages/webapp/.output ./output
COPY --from=builder /src/packages/webapp/server/db/migrations ./migrations
COPY deploy/migrate.mjs ./output/server/migrate.mjs
COPY deploy/create-admin.mjs ./output/server/create-admin.mjs
COPY deploy/healthcheck.mjs ./healthcheck.mjs
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# node 镜像自带 uid=1000 的非特权用户；应用不写本地磁盘（数据落 PostgreSQL 与对象存储）
USER node

EXPOSE 3000

# 健康检查以数据库可用为准：全新部署在配置模型供应商前，就绪状态本就是 degraded，
# 若把 ready 作为存活条件，容器会被误判为不健康
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "/app/healthcheck.mjs"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
