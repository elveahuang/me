# 部署指南（Docker / Podman Compose）

用一份 Compose 文件把 EE 智能体平台跑起来：PostgreSQL + Redis + Web/API，可选 RustFS 对象存储（附件功能需要）。

本文所有命令都在**仓库根目录**执行，且已在 Docker + Compose V2 上完整跑通（含构建、迁移、健康检查、附件上传、重启与 down/up 数据持久化）。

---

## 1. 快速开始

```bash
# 1) 生成部署配置（随机强密钥，写入 deploy/.env）
node deploy/init-env.mjs

# 2) 启动（首次会自动构建镜像）
docker compose -f deploy/compose.yaml up -d --build

# 需要附件功能时启用对象存储
docker compose -f deploy/compose.yaml --profile storage up -d --build

# 3) 查看状态与日志
docker compose -f deploy/compose.yaml ps
docker compose -f deploy/compose.yaml logs -f app
```

浏览器打开 <http://localhost:3000>。首次部署尚无账号，先创建管理员（见下一节）。

`init-env.mjs` 会把管理员初始口令打印在终端，请先记录；之后也可在 `deploy/.env` 查看。

### Podman 说明

`deploy/compose.yaml` 只使用 Compose 规范内的字段，Podman 可直接消费：

```bash
podman compose -f deploy/compose.yaml up -d --build   # 或 podman-compose -f deploy/compose.yaml up -d
```

两点差异需要留意：

- **镜像名**：Podman 需要完整的本地镜像名，`ee-webapp:latest` 已显式指定 `image:` 字段，可直接使用。
- **无根模式**：容器内已使用非 root 用户（`node`，uid 1000），并存放在命名卷中，无需额外 `--userns` 配置。

---

## 2. 创建管理员

生产镜像只包含构建产物，没有 `tsx` 等开发依赖，因此**不能**在容器里执行 `pnpm webapp:db:seed`。首次创建管理员用内置脚本：

```bash
# 使用 deploy/.env 里的 ADMIN_INITIAL_PASSWORD
docker compose -f deploy/compose.yaml exec app node /app/output/server/create-admin.mjs

# 或指定其他账号与口令
docker compose -f deploy/compose.yaml exec \
  -e ADMIN_EMAIL=ops@example.com -e ADMIN_PASSWORD='你的强口令' \
  app node /app/output/server/create-admin.mjs
```

脚本是幂等的：账号已存在时只确保其为管理员，**不会覆盖已有密码**。创建后即可登录 `/admin`。

### 需要示例数据时（可选）

如果想一次性得到示例智能体、Skill、Tool 与会员套餐（等同开发环境的 `pnpm webapp:db:seed`），需要临时让本机连上容器数据库，再从源码执行 seed：

```bash
# 1) 临时把数据库映射到本机（避开本机已占用的 5432）
cat > deploy/compose.override.yaml <<'YAML'
services:
  postgres:
    ports:
      - '127.0.0.1:15432:5432'
YAML

docker compose -f deploy/compose.yaml up -d postgres

# 2) 用 override 的端口执行 seed（口令取自 deploy/.env）
POSTGRES_URL="postgresql://ee:$(grep ^POSTGRES_PASSWORD= deploy/.env | cut -d= -f2)@localhost:15432/ee" \
ADMIN_EMAIL=admin@example.com \
ADMIN_INITIAL_PASSWORD='你的强口令' \
pnpm --filter @repo/webapp db:seed

# 3) 移除端口映射并恢复
rm deploy/compose.override.yaml
docker compose -f deploy/compose.yaml up -d postgres
```

> seed 会**覆盖**部分既有配置（套餐、示例 agent 及其绑定），不要在生产库上重复执行。

---

## 3. 服务构成

| 服务          | 镜像                   | 作用                                       | 默认对外端口    |
| ------------- | ---------------------- | ------------------------------------------ | --------------- |
| `app`         | 本地构建 `ee-webapp`   | Nuxt 4 页面 + `/api/*`，启动时自动迁移     | `3000`          |
| `postgres`    | `postgres:17-alpine`   | 全部业务表（认证、会话、计费、内容、附件） | 仅容器网络      |
| `redis`       | `redis:7-alpine`       | 分布式限流与缓存                           | 仅容器网络      |
| `rustfs`      | `rustfs/rustfs:latest` | S3 协议对象存储（`--profile storage`）     | `9000` / `9001` |
| `rustfs-init` | `minio/mc:latest`      | 一次性创建存储桶后退出                     | —               |

数据库与 Redis **默认不发布到宿主机**，只在 Compose 内部网络可达，减少暴露面。需要本地连接时取消 `compose.yaml` 中对应 `ports` 的注释。

---

## 4. 镜像构建方式

`deploy/Dockerfile` 采用两阶段构建：

- **builder**：用 corepack 按 `packageManager` 字段安装 pnpm，装齐依赖后执行 `nuxt build`。
- **runner**：只复制 `.output`（自包含，约 50MB）+ 迁移文件，**不带 1.9GB 开发依赖**，最终镜像约 410MB。

构建上下文为仓库根目录，由 `compose.yaml` 的 `context: ..` 指定；`.dockerignore` 已排除 `node_modules`、`.output`、`.env`、证书与 `.git`。

镜像内不包含 `drizzle-kit`（属开发依赖）。迁移器只有两个小文件，构建阶段从 `packages/webapp/node_modules/drizzle-orm` 复制进 `.output`，因此容器启动即可应用迁移，且与本地 `pnpm webapp:db:migrate` 使用同一张 `__drizzle_migrations` 表。

重新构建：

```bash
docker compose -f deploy/compose.yaml build app
docker compose -f deploy/compose.yaml up -d app
```

---

## 5. 数据库迁移

容器启动时由 `docker-entrypoint.sh` 自动执行 `migrate.mjs`：先按 `POSTGRES_URL` 应用迁移，成功后启动服务。迁移是幂等的，重复启动只输出一行"迁移完成"。

- 数据库未就绪时会重试（默认最多 30 次、每次间隔 2 秒），因此不必担心 `depends_on` 之外的启动时序。
- 关闭自动迁移（例如多副本部署只想让一个实例迁移）：设置 `MIGRATE_ON_START=false`。
- 调整重试次数：`MIGRATE_MAX_ATTEMPTS`。

> 多副本场景建议只让单个实例开启自动迁移，或改为在 CI/CD 中单独执行迁移后再滚动更新。

---

## 6. 健康检查

`/api/health` 无论健康与否都返回 HTTP 200，状态体现在响应体，因此镜像内的探针（`deploy/healthcheck.mjs`）会解析 JSON 并按**数据库可用**判定：

```bash
docker compose -f deploy/compose.yaml exec app node /app/healthcheck.mjs
curl -s http://localhost:3000/api/health | head -c 400
```

判定标准是数据库 `up` 而非 `ready`。全新部署未配置模型供应商时，`ready` 为 `false`、整体状态为 `degraded` 属于正常；若以 `ready` 作为存活条件，首次部署的容器会被反复重启。

响应中的 `checks` 可用于排查（每项只返回状态，不含内部细节）：

| 字段            | up               | degraded / not_configured                    |
| --------------- | ---------------- | -------------------------------------------- |
| `database`      | 连接正常         | 决定容器是否健康，异常需先查 `POSTGRES_URL`  |
| `redis`         | 已连接           | 降级为单进程内存限流（多实例下不再全局一致） |
| `wechat`        | 支付与登录均配置 | 未配置或仅配置其一                           |
| `modelProvider` | 存在可用供应商   | 未配置 Key（可在管理后台补）                 |

> 该接口无需鉴权，因此**不返回**供应商地址、数据库错误原文、Node 版本或内存信息——需要这些细节请看服务端日志。探测模型供应商时用的是只读查询，不会在 `providers` 表为空时插入默认行（即探针请求无写库副作用）。

---

## 7. 对象存储（附件功能）

附件模块走 S3 协议，`--profile storage` 会启动 RustFS 并自动创建私有桶（`rustfs-init`）。

启动后到管理后台 **存储配置** 新建一条配置，**Endpoint 必须填容器服务名**（不是 localhost，因为请求由 `app` 容器发起）：

| 字段         | 值                                     |
| ------------ | -------------------------------------- |
| Endpoint     | `http://rustfs:9000`                   |
| Region       | `us-east-1`                            |
| Bucket       | `deploy/.env` 里的 `RUSTFS_BUCKET`     |
| Access Key   | `deploy/.env` 里的 `RUSTFS_ACCESS_KEY` |
| Secret Key   | `deploy/.env` 里的 `RUSTFS_SECRET_KEY` |
| 路径风格访问 | 开启（自建存储必需）                   |

保存后点「测试连接」，返回"连接成功"即配置正确，随后可在 `/attachments` 上传。RustFS 控制台在 <http://localhost:9001>。

> 桶保持私有，附件通过预签名 URL 访问。若要直接公开访问，在配置中填写「公开访问前缀」指向可公开的地址。

---

## 8. 配置项

`deploy/.env` 由 `node deploy/init-env.mjs` 生成（模板见 `deploy/.env.example`）。**该文件已在 `.gitignore` 中**，不要提交。

必填项：

| 变量                     | 说明                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`      | 数据库口令，自动随机生成                                             |
| `BETTER_AUTH_SECRET`     | 会话签名密钥。生产环境使用占位符会被 `env-guard` 拒绝启动            |
| `BETTER_AUTH_URL`        | **对外访问地址，必须与实际访问地址一致**，否则登录态与微信回调会失效 |
| `ADMIN_INITIAL_PASSWORD` | 创建管理员时使用                                                     |
| `REDIS_PASSWORD`         | Redis 口令                                                           |

常改项：

| 变量                     | 默认    | 说明                                                   |
| ------------------------ | ------- | ------------------------------------------------------ |
| `APP_PORT`               | `3000`  | 应用对外端口                                           |
| `CORS_ORIGINS`           | 空      | 额外允许的来源，逗号分隔；留空仅放行 `BETTER_AUTH_URL` |
| `NUXT_DEEPSEEK_API_KEY`  | 空      | 也可稍后在管理后台「模型供应商」中配置                 |
| `MOCK_PAY_ENABLED`       | `false` | 生产开启会用模拟支付绕过真实收款，确认后再改           |
| `ALLOW_PRIVATE_OUTBOUND` | `false` | HTTP 工具是否可访问内网（默认拒绝，防 SSRF）           |

> `init-env.mjs` 不会覆盖已存在的 `.env`。用 `--force` 重建会更换数据库口令与签名密钥：前者与已初始化的数据卷不再匹配，后者会使所有登录会话失效。

---

## 9. 升级与运维

```bash
# 拉取新代码后重建并滚动替换
git pull
docker compose -f deploy/compose.yaml up -d --build

# 停止（保留数据卷）
docker compose -f deploy/compose.yaml down

# 连同数据一起清除（危险：数据库与对象存储都会丢失）
docker compose -f deploy/compose.yaml --profile storage down -v
```

数据保存在命名卷 `ee_postgres-data`、`ee_redis-data`、`ee_rustfs-data` 中，`down`（不带 `-v`）不会删除。

**备份**：

```bash
docker compose -f deploy/compose.yaml exec -T postgres \
  pg_dump -U ee -d ee -Fc > backup-$(date +%F).dump
```

**恢复**：

```bash
docker compose -f deploy/compose.yaml exec -T postgres \
  pg_restore -U ee -d ee --clean --if-exists < backup-2026-09-18.dump
```

---

## 10. 放到反向代理后面（HTTPS）

应用本身不处理 TLS，建议由 Nginx / Caddy / Traefik 终止 TLS。两处必须同步修改：

1. `deploy/.env` 的 `BETTER_AUTH_URL` 改成对外地址，例如 `https://ee.example.com`。
2. `CORS_ORIGINS` 加上同样的来源（多个用逗号分隔）。

Nginx 参考片段（注意保留流式响应所需的关闭缓冲）：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # 对话是 SSE 流式返回，必须关闭缓冲
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

改完后 `docker compose -f deploy/compose.yaml up -d app` 让新环境变量生效。

---

## 11. 故障排查

| 现象                                           | 排查方向                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 容器反复重启，日志含 `refusing to start`       | `env-guard` 拦下占位符密钥：确认 `BETTER_AUTH_SECRET`、`ADMIN_INITIAL_PASSWORD` 是真实值 |
| `BETTER_AUTH_URL` 与实际不符导致登录后立刻掉线 | 改 `deploy/.env` 后 `up -d app` 重建容器                                                 |
| 日志出现 `password authentication failed`      | 数据卷已按旧口令初始化过：改回原口令，或 `down -v` 后重建（会丢数据）                    |
| 附件上传报"对象存储缺少访问密钥"               | 管理后台存储配置里 Access Key / Secret Key 未填                                          |
| 附件连接测试失败                               | Endpoint 写成了 `localhost`：应用在容器内，应填服务名 `http://rustfs:9000`               |
| `/api/health` 里 `redis` 为 degraded           | Redis 未就绪或口令不匹配；此时限流降级为单进程内存，多实例部署下不再全局一致             |
| 页面能打开但 `ready: false`                    | 未配置模型供应商，属正常状态；到管理后台配置或设置 `NUXT_DEEPSEEK_API_KEY`               |

常用诊断命令：

```bash
docker compose -f deploy/compose.yaml ps
docker compose -f deploy/compose.yaml logs --tail=100 app
docker compose -f deploy/compose.yaml exec app node /app/healthcheck.mjs
docker compose -f deploy/compose.yaml exec postgres psql -U ee -d ee -c '\dt'
```

---

## 12. 已验证范围

以下均在 Docker + Compose V2 上实测通过：

- 镜像构建（builder → runner，最终约 410MB）
- 启动顺序与健康检查：`postgres`/`redis` 健康后 `app` 启动，三个服务最终均为 `healthy`
- 启动自动迁移；重启与重新部署时迁移幂等（不重复创建，日志无噪声）
- 首页 SSR、登录页、未登录访问受保护接口返回 401
- 注册 → 登录 → 会话 → 业务接口（`/api/agents`、`/api/news`、`/api/notifications`、`/api/bulletins`、`/api/attachments`）
- 管理员创建脚本（创建与幂等两条路径）及管理端接口（统计、存储、资讯、通知）
- 对象存储：桶自动创建、容器内 RustFS 连接自检、上传 → 下载 → 删除全链路
- `down` 后再 `up`：数据卷保留，管理员账号与配置仍在
- 源码 seed 路径（临时映射数据库端口）可正常写入，且数据在应用中可见

**未覆盖**：HTTPS/反向代理的真实终止、微信支付与登录的真实回调、多副本横向扩展下的限流一致性。这些需要在目标环境中另行验证。
