# @repo/www

基于 [Void](https://void.cloud) + Vue 的最小可运行示例（Pages 模式）。

## 启动

```bash
pnpm --filter @repo/www dev      # 或仓库根 pnpm www:start
pnpm --filter @repo/www build    # 或仓库根 pnpm www:build
```

`dev` 由 Vite 驱动；`build` 会产出 `void_worker` 与 client 两套产物，落在 `apps/www/.cloudflare/output/`。

## 结构

| 路径             | 说明                                                    |
| ---------------- | ------------------------------------------------------- |
| `pages/`         | 文件即路由；`pages/index.vue` 是首页                    |
| `vite.config.ts` | 挂 `voidPlugin()` + `voidVue()`                         |
| `void.config.ts` | Void 项目配置（目前只声明 worker 兼容日期）             |
| `.void/`         | `void prepare` 生成的类型与路由声明，不要手改、不要提交 |

## 两个约定

- **配置文件必须是 `void.config.ts`**（或旧式 `void.json`）。Void 的配置加载器只认这两个名字，
  写成 `void.config.mjs` 会被静默忽略——项目照跑，但里面的 `worker.compatibility_date` 一概不生效。
- `tsconfig.json` 的 `extends` 指向 `.void/tsconfig.json`，由 `postinstall` 里的 `prepare` 脚本生成。
  首次 clone 后若 IDE 报找不到 `void/routes`，执行 `pnpm --filter @repo/www prepare`。

## 扩展路径

当前是 **Pages 模式**：没有数据库、没有 `pages/*.server.ts`、没有 `routes/`。要长成全栈应用时再加这些目录，
base 约定见 [Void 文档](https://void.cloud/guide/quickstart)，不要套用 Nuxt 的 `server/api` 约定。
