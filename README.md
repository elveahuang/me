# ME

全栈 AI 智能体平台（付费 AI 应用基础）：pnpm monorepo，包含 Web 应用（用户端 + 管理端）与移动端（Ionic + Capacitor，备选 Konsta UI 组件），webapp 服务端同时为两端（及未来小程序）提供统一 API。

## 功能

- **注册 / 登录**：基于 [better-auth](https://better-auth.com)（邮箱 + 密码），`admin` 插件提供角色与封禁管理；微信公众号网页授权登录（`/api/auth/wechat`，需配置公众号凭据，仅微信内浏览器）
- **会员与支付**：套餐（免费/专业/旗舰）+ 订单 + 微信支付（[better-wechatpay](https://better-wechatpay.vikingz.me/)，Native 扫码 / JSAPI 公众号内 / H5 跳转三形态）；支付渠道抽象层（`lib/payments`），新增支付宝等渠道只需注册新实现；未配置微信凭据时自动兜底 mock 渠道（仅开发环境可用），本地可跑通 下单 → 支付 → 开通 全流程
- **配额控制**：按套餐限制每日对话次数（原子检查+计数，超限 402 引导升级），续费从当前到期时间顺延，月末日期 clamp；管理端可管理套餐与查看订单
- **国际化**：i18next + react-i18next，简体中文 / English 双语（webapp 用户侧与 mobile 全部页面），语言偏好持久化
- **与智能体对话**：AI SDK v7（Vercel）流式对话，消息落库（PostgreSQL + Drizzle ORM），上下文窗口截断（最近 24 条）
- **Skill 系统**：可复用的指令块，挂载到智能体后注入系统提示词（管理端 CRUD）
- **Tool 系统**：后台可配置的 AI 工具（AI SDK tool calling），内置时间工具 + 自定义 HTTP 工具（URL/请求体支持 `{{参数}}` 模板）
- **MCP Tools**：接入 Model Context Protocol 服务器（Streamable HTTP / SSE / stdio 三种传输），挂载到智能体后其工具自动进入 ReAct 循环；支持一键「测试连接」枚举远端工具
- **自定义 AI 供应商**：接入任意 OpenAI 兼容协议供应商（DeepSeek / Moonshot / Ollama / OpenRouter 等），密钥服务端保存、界面掩码展示
- **AI 自动配置**：输入智能体用途描述，AI 自动生成名称/人设/模型/Skills/Tools/MCP/知识库 配置草案，初步形成完整的 ReAct Agent
- **RAG 知识库**：文档自动切块入库；配置了 Embedding 供应商走向量检索，否则退化为关键词匹配；对话时检索相关内容注入上下文（seed 自带「平台使用指南」示例知识库）
- **对话体验**：流式输出可随时停止（webapp/mobile 双端），服务端中断安全（保留已生成内容）
- **防滥用**：对话接口按用户限流（30 次/分）、超大消息体拒绝（512KB 上限）、会话创建限流（20 次/分）
- **AI 渲染管线**：助手回复用 Comark（Markdown + 组件语法 + 流式 autoClose）渲染，
  `json-render` 代码块（由 @json-render/core 的 catalog 生成提示词驱动）渲染成 Card / Stat / Badge / Alert 组件
- **双端用户侧**：webapp、mobile（Ionic 9 + React Router + Capacitor 7 + 备选 Konsta UI 组件）对等实现注册登录（邮箱/微信）、智能体列表、会话管理、流式对话、会员购买与订单查询
- **管理侧（仅 webapp）**：数据总览、智能体管理、Skills、Tools、知识库、AI 供应商、用户管理（角色 / 封禁）、套餐管理、订单列表
- **多客户端 API**：全部业务接口同时支持 Cookie（webapp）与 Bearer token（mobile/小程序），契约见 [docs/api.md](docs/api.md)

## 目录结构

```
packages/
  webapp/   # TanStack Start (React 19 + Vite + Nitro) + better-auth + Drizzle + HeroUI v3
            #   src/routes/        页面 + /api/* 服务端路由（server.handlers）
            #   src/db/schema.ts   Drizzle 表定义
            #   src/lib/           auth / ai / catalog(json-render) / tools / rag / cors 等
  mobile/   # Ionic 9.0.1 + React Router 6 + Capacitor 7 + Konsta UI（备选组件层）；对接 webapp API
  config/   # 共享 tsconfig / eslint / prettier 配置
scripts/    # 仓库脚手架脚本（init / build / update）
```

## 快速开始

### 1. 数据库

需要 PostgreSQL（默认 `postgres://root:root@localhost:5432/me`，可在 `packages/webapp/.env.local` 的 `DATABASE_URL` 覆盖）：

```shell
pnpm run webapp:db:migrate   # drizzle-kit push，建表
pnpm run webapp:db:seed      # 创建管理员 + 示例 Skills/Tool + 示例智能体
```

Seed 管理员邮箱默认 `admin@example.com`，口令通过环境变量 `ADMIN_INITIAL_PASSWORD` 指定（未设置时生成随机口令并仅在 seed 输出中显示一次）。

### 2. Webapp

```shell
pnpm run webapp:start        # http://localhost:3000
```

AI key（至少配一个）写入 `packages/webapp/.env.local` 或环境变量：`DEEPSEEK_API_KEY` / `OPENAI_API_KEY`；
并设置 `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL=http://localhost:3000`。

用户侧：`/login`、`/register`、`/chat`；管理侧：`/admin`（需 admin 角色）。

### 3. Mobile（Ionic + Capacitor）

```shell
pnpm run mobile:start        # http://localhost:8100
pnpm run mobile:build        # 产出 dist/，可用 npx cap add ios/android + pnpm run mobile:sync 打包原生壳
```

- 主组件层为 Ionic；`/konsta-demo` 路由演示 Konsta UI 备选组件（iOS 风格，由 Tailwind CSS 构建）
- API 地址通过 `packages/mobile/src/lib/config.ts` 或构建时 `VITE_API_URL` 配置
- 鉴权使用 better-auth 的 Bearer 模式：登录响应中的 `token` 存 localStorage，请求时带 `Authorization: Bearer <token>`
- 微信登录：登录页「微信登录」按钮跳转服务端发起公众号授权，回调以 `#token=` 回跳 `/wechat-callback`（需配置 `MOBILE_APP_URL`）

## 技术要点

- 服务端路由：TanStack Start 文件路由的 `server.handlers`（`src/routes/api/**`），
  AI 聊天为 `POST /api/chat`（AI SDK UI message stream，SSE），通过 `x-conversation-id` 响应头回传新建会话 ID
- 聊天持久化：客户端消息按 UIMessage id 幂等落库；助手消息由服务端自行 tee 消费 UI 流后落库
  （不依赖 AI SDK v7 已弃用的 response `onFinish`）；`messages.seq`（bigserial）保证排序稳定
- 会员/支付：订单金额以套餐快照为准（不信任客户端）；支付成功开通走条件更新事务（幂等 + 并发守卫）；
  微信回调 `POST /api/pay/notify/wechat` 靠平台签名验证并比对回调金额；配额为原子「检查+计数」
- 微信登录：不走 better-auth genericOAuth（微信 OAuth 非标），自定义授权流直接写 better-auth 的
  session/account 表（provider `wechat`，accountId 为 openid），与密码登录在 `requireUser` 层完全一致
- MCP：`src/lib/mcp.ts` 按请求连接 MCP 服务器（Streamable HTTP/SSE/stdio），`listTools` 动态转换为
  AI SDK `dynamicTool`（工具名加 `mcp{serverId}_` 前缀防冲突），聊天结束后统一关闭连接
- 限流：`src/lib/rate-limit.ts` 内存滑动窗口（单实例足够，多实例部署需换共享存储）
- json-render：`src/lib/catalog.ts` 同时供服务端 `catalog.prompt()` 生成提示词、
  客户端 Comark `jsonRender()` 插件渲染 ```json-render 代码块
- CORS：OPTIONS 预检由 `src/lib/cors.ts` 中间件短路，实际响应头由 `json()`/聊天流统一附加；
  仅对白名单内的来源回显 allow-origin，允许来源可用 `CORS_ORIGINS` 环境变量覆盖（默认含 Ionic/Vite/Capacitor 本地端口）
- better-auth 1.7 会对所有 POST 强制 Origin 校验（拒绝 curl/移动端等非浏览器客户端），
  已显式关闭并改由 SameSite=Lax Cookie 兜底
- nitro 3 beta + vite 8 (rolldown) 多 chunk 构建存在导出损坏问题，
  webapp 构建已配置服务端单 chunk 输出（`vite.config.mjs`）规避
