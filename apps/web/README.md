# @repo/web

本机 AI 工作台：单主、无账号体系、独立数据库（mw）的 Nuxt 4 应用。

> 它没有登录层，跨站写防护只靠回环绑定 + Origin 闸门。**把 `apps/web` 暴露到公网前必须先自行加鉴权**，
> 只做反向代理那一步等于把可写库敞开。

## 启动

```bash
cp .env.example .env          # 至少填 POSTGRES_URL
pnpm --filter @repo/web db:migrate
pnpm --filter @repo/web db:seed
pnpm --filter @repo/web dev   # 或仓库根 pnpm web:start，127.0.0.1:3001
```

## 常用脚本

| 命令                                 | 说明                                           |
| ------------------------------------ | ---------------------------------------------- |
| `dev` / `build`                      | Nuxt 开发 / 生产构建（产物在 `.output`）       |
| `db:generate` / `:migrate` / `:seed` | Drizzle 迁移与种子，都有真实副作用             |
| `test` / `smoke-test`                | 纯函数 + locales 对账的冒烟测试                |
| `typecheck`                          | `nuxt typecheck`                               |
| `icons` / `icons:check`              | 重新生成 / 校验 `app/utils/app-icons.ts`       |
| `bench`                              | 本机负载基线（同机改动前后对比，不是容量结论） |

## 冒烟测试与数据库

`pnpm --filter @repo/web test` 在启动时探测一次数据库：

- **连得上** → 全量断言（含 jobs/skills 落库、第 18 节连通性与幂等索引）；
- **连不上** → 打印警告并跳过这些依赖真实库的段落，其余纯函数与配置断言照常执行，最后仍按失败数退出。

所以 CI 不提供 PostgreSQL 时它也能跑完；要跑全量请先配置 `POSTGRES_URL`。

## 环境变量

配置项见 [.env.example](.env.example)。前缀统一为 `WEB_*`（安全相关：`WEB_SECRET_KEY` 用于数据库内
API Key / 存储密钥的 AES-256-GCM 加密，`WEB_ALLOW_PUBLIC_BIND` 放行非回环绑定）。

## 边界

- `packages/commons` 通过 `@commons/*` 别名使用，别名在 `nuxt.config.ts` 指向 `../../packages/commons/src`。
- `server/utils/` 里用到其他 server 工具时必须显式 import：Nitro 自动导入只在 Nuxt 构建期内生效，
  `tsx` 直跑脚本（冒烟测试、回填脚本）时没有这层魔法。
- `h3` 必须精确钉 `1.15.11`（根 `pnpm-workspace.yaml` 有 override 护栏），不能升到 `^2`。
