# ME

全栈 AI 智能体平台：pnpm monorepo，包含 Web 应用（用户端 + 管理端）与移动端（Expo）。

## 功能

- **注册 / 登录**：基于 [better-auth](https://better-auth.com)（邮箱 + 密码），`admin` 插件提供角色与封禁管理
- **与智能体对话**：AI SDK v7（Vercel）流式对话，消息落库（PostgreSQL + Drizzle ORM）
- **Skill 系统**：可复用的指令块，挂载到智能体后注入系统提示词（管理端 CRUD）
- **AI 渲染管线**：助手回复用 Comark（Markdown + 组件语法 + 流式 autoClose）渲染，
  `json-render` 代码块（由 @json-render/core 的 catalog 生成提示词驱动）渲染成 Card / Stat / Badge / Alert 组件
- **双端用户侧**：webapp 与 mobile 各自实现注册登录、智能体列表、会话与流式对话
- **管理侧（仅 webapp）**：数据总览、智能体管理、Skill 管理、用户管理（角色 / 封禁）

## 目录结构

```
packages/
  webapp/   # TanStack Start (React 19 + Vite + Nitro) + better-auth + Drizzle + HeroUI v3
            #   src/routes/        页面 + /api/* 服务端路由（server.handlers）
            #   src/db/schema.ts   Drizzle 表定义
            #   src/lib/           auth / ai / catalog(json-render) / prompt 等
  mobile/   # Expo SDK 57 + expo-router + uniwind；REST + Bearer token 对接 webapp API
  config/   # 共享 tsconfig / eslint / prettier 配置
```

## 快速开始

### 1. 数据库

需要 PostgreSQL（默认 `postgres://root:root@localhost:5432/me`，可在 `packages/webapp/env.local` 的 `DATABASE_URL` 覆盖）：

```shell
pnpm run webapp:db:migrate   # drizzle-kit push，建表
pnpm run webapp:db:seed      # 创建管理员 + 示例 Skills + 示例智能体
```

Seed 产出的管理员：`admin@example.com / admin123456`（请上线前修改）。

### 2. Webapp

```shell
pnpm run webapp:start        # http://localhost:3000
```

AI key（至少配一个）写入 `packages/webapp/env.local` 或环境变量：`DEEPSEEK_API_KEY` / `OPENAI_API_KEY`；
并设置 `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL=http://localhost:3000`。

用户侧：`/login`、`/register`、`/chat`；管理侧：`/admin`（需 admin 角色）。

### 3. Mobile

```shell
pnpm run mobile:start        # Expo dev server
```

- 默认连接 `http://localhost:3000`；真机调试请设置环境变量 `EXPO_PUBLIC_API_URL=http://<电脑局域网IP>:3000`
- 鉴权使用 better-auth 的 Bearer 模式：登录响应中的 `token` 存入 expo-secure-store，请求时带 `Authorization: Bearer <token>`

## 技术要点

- 服务端路由：TanStack Start 文件路由的 `server.handlers`（`src/routes/api/**`），
  AI 聊天为 `POST /api/chat`（AI SDK UI message stream，SSE），通过 `x-conversation-id` 响应头回传新建会话 ID
- 聊天持久化：客户端消息按 UIMessage id 幂等落库；助手回复在 `onFinish` 落库；`messages.seq`（bigserial）保证排序稳定
- json-render：`src/lib/catalog.ts` 同时供服务端 `catalog.prompt()` 生成提示词、
  客户端 Comark `jsonRender()` 插件渲染 ```json-render 代码块
- react-native 0.87 移除了 `rn-get-polyfills`，而 Expo CLI 57 仍会加载它（web 平台），
  已用 `patches/react-native@0.87.1.patch` 修复（`pnpm-workspace.yaml` 的 `patchedDependencies`）
