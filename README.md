# ME 智能体平台

基于 Nuxt 4 + Vue 3 的智能体对话平台：Web（Nuxt UI）与移动端（Ionic + Capacitor）共用一套后端，支持自定义模型供应商、可配置
Skill 工具、MCP 服务器接入、RAG
知识库与智能体自治配置，构成完整的 ReAct Agent。

## 架构

```
packages/
  webapp/    Nuxt 4 全栈（SSR 页面 + Nitro API）
    server/
      api/            auth(better-auth)/chat/conversations/agents + admin/*
      utils/          db(drizzle)/auth/providers/skills/mcp/embedding
      middleware/     better-auth 挂载
      db/schema.ts    全部表定义（drizzle-orm + PostgreSQL）
    app/
      pages/          用户侧 /login /register /chat /profile；管理侧 /admin/*
      utils/          json-ui.ts（json-render 组件映射，供 Comark 渲染）
      components/     ChatMessage（Comark markdown + json-render 生成式 UI）
  mobile/    Ionic 9 + Capacitor 8，vite dev proxy 指向 webapp
  commons/   共享契约（src/contract）与主题令牌（src/styles/theme.css）；其他 api/store/i18n/services 按需接入
  config/    eslint/prettier/stylelint/tsconfig 共享配置
```

## 主题与多端一致性

- **主题**：浅色 / 深色 / 跟随系统 + 蓝色 / 绿色 / 黄色 / 红色四套品牌色，Web 与移动端共用
  `packages/commons/src/styles/theme.css` 的令牌（`--brand-*` / `--surface*` / `--content*`）。
  Web 端由 `app/composables/useTheme.ts`（Nuxt UI color-mode + `data-brand` cookie，SSR 直出无闪色）
  驱动；移动端由 `src/composables/useTheme.ts`（localStorage + `<html data-brand>`）驱动。
  页面样式统一使用语义类：`app-card` / `app-btn-primary` / `app-input` / `bg-brand` / `text-soft` …，
  换主题只改变量，不需要改模板。
- **接口契约**：两端接口类型、错误文案归一化（`extractApiError`）、金额/日期/额度格式化都来自
  `packages/commons/src/contract/index.ts`（两端通过 `@commons/contract` 引用），避免 Web 与移动端解析同一接口时字段不一致。
- **移动端样式**：`packages/mobile` 通过 `@tailwindcss/vite` 接入 Tailwind v4，与 Web 共用同一套令牌；
  Ionic 组件（toolbar / content / tab-bar / input）在 `src/theme/theme.css` 中映射到同一批 CSS 变量。
- **移动端鉴权**：浏览器与开发环境走同源 cookie；原生壳使用 better-auth bearer 插件，
  微信回跳地址为 `<MOBILE_APP_URL>wechat-callback#token=...`，token 存 localStorage 后由
  `src/api/client.ts` 统一附加 `Authorization`。打包原生 App 时用 `VITE_API_BASE` 指向远端后端。

## 快速开始

```bash
# 1. 依赖
pnpm install

# 2. 数据库（PostgreSQL，本地实例）
#    创建库后执行迁移
pnpm webapp:db:generate
pnpm webapp:db:migrate

#    注意：若数据库由旧的「Skill=Tool 合并」结构升级而来，需重建 schema 后再迁移
#    （DROP SCHEMA public CASCADE; CREATE SCHEMA public;），迁移文件已重新生成

# 3. 配置环境
cp packages/webapp/.env.example packages/webapp/.env
#    填 POSTGRES_URL / BETTER_AUTH_SECRET / NUXT_DEEPSEEK_API_KEY

# 4. 启动
pnpm webapp:start      # http://localhost:3000
pnpm mobile:start      # Ionic dev，/api 代理到 3000

# 5. 管理后台
#    注册的第一个用户默认 role=user，用 SQL 提升为 admin 后即可进入 /admin：
#    update "user" set role='admin' where email='you@example.com';
```

## 生产部署注意

- `node .output/server/index.mjs` 不读取 `.env`，需用 pm2/docker 注入
  `POSTGRES_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`NUXT_DEEPSEEK_API_KEY`
- **密钥必须替换**：`server/plugins/env-guard.ts` 会拒绝在生产环境使用 `.env.example` 里的占位符启动，
  请用 `openssl rand -base64 32` 生成 `BETTER_AUTH_SECRET`，并设置强 `ADMIN_INITIAL_PASSWORD`
- 跨域来源通过 `CORS_ORIGINS`（逗号分隔）配置，同时作用于 better-auth `trustedOrigins` 与
  `server/middleware/cors.ts`；`.env` 里的 `ALLOW_PRIVATE_OUTBOUND=true` 才会放行 HTTP 工具访问内网（默认拒绝，防 SSRF）
- 向量检索需要「支持 /embeddings 的供应商」（OpenAI / 通义 / 自建网关）。若知识库挂在 DeepSeek 这类
  只有 chat 接口的供应商上，向量生成会失败并自动降级为 Bigram 关键词检索，
  可在管理端「知识库 → 重建索引」重试并查看失败原因
- better-auth 已启用限流（登录/注册 20 次/分钟）；移动端原生壳的 origin
  （`capacitor://localhost` / `https://localhost`）已在 `trustedOrigins` 放行

## 开发与 CI

```bash
pnpm run lint        # eslint（webapp / mobile / commons）
pnpm run typecheck   # nuxt typecheck + vue-tsc
pnpm run test        # 冒烟测试（20 项，含 DB 连通性）
pnpm run webapp:build && pnpm run mobile:build
```

`.github/workflows/ci.yml` 在 push / PR 时执行上面这套校验；`pnpm install` 会通过 `prepare`
脚本安装 husky 钩子（提交前执行 lint-staged：eslint --fix + prettier）。

## 核心概念

| 概念       | 说明                                                                                                                            | 管理入口         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 供应商     | OpenAI 兼容协议（DeepSeek/通义/OpenAI/自建网关），填 Base URL + Key，「测试连接」自动拉取模型列表                               | /admin/providers |
| Skill      | **可复用的指令块（不可执行）**。挂载到智能体后其 `instructions` 注入系统提示词，支持 `{{user_name}}` 等模版变量                 | /admin/skills    |
| Tool       | **可执行的 AI SDK 工具**。`builtin_time`（内置查询时间）或 `http`（后台配置 URL/方法/参数 schema，无需写代码）                  | /admin/tools     |
| MCP Server | 通过 Model Context Protocol（Streamable HTTP/SSE）接入外部工具集，工具命名空间化为 `mcp_<server>_<tool>`                        | /admin/mcp       |
| 知识库     | 文档分块 + 向量化（/embeddings），对话时余弦检索 top-5 注入 system prompt                                                       | /admin/knowledge |
| 自治配置   | 开启后智能体获得 `self-config` 工具：自主查看/切换模型、绑定解绑 Skill / Tool / MCP 服务器                                      | 智能体编辑页     |
| 生成式 UI  | **提示词驱动**：`catalog.prompt()` 教模型在 Markdown 里输出 `json-render` 代码块，Comark 插件渲染成 Card / Stat / Badge / Alert | —                |
| ReAct      | 服务端 `streamText` + `stopWhen(maxSteps)` 自动回灌工具结果多步推理；客户端 UIMessage 协议续轮                                  | —                |

## 技术栈

Nuxt 4 / Vue 3 / Vite · drizzle-orm + PostgreSQL · better-auth（admin/bearer 插件）·
AI SDK v7（@ai-sdk/openai chat-completions + @ai-sdk/mcp）· @comark/vue（markdown）·
@json-render/vue（生成式 UI）· Ionic 9 + Capacitor 8 · Element Plus / ECharts / TipTap 等组件库（根依赖）
