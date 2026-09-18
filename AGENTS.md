# AGENTS.md — EE 智能体平台

> 项目知识核实日期：2026-09-18。本文是后续代理的工作入口，不是运行验证报告。
> 优先使用本文定位相关模块，再读本次修改涉及的实现；不要每次重新扫描整个仓库。
> 当代码与本文或 README 冲突时，以当前源码、包脚本和配置为准，并在相关任务中更新本文。

## 1. 工作方式与边界

- 默认使用中文沟通。先理解用户要的是分析还是修改；分析任务不顺手改业务代码。
- 开始先检查 `git status --short`，保留已有未提交修改。不要重置、覆盖或把无关变更一起提交。
- 使用 pnpm workspace，不混用 npm/yarn 安装，不为了排障无差别升级依赖或重建锁文件。
- 按任务范围查找文件，排除 `node_modules`、`.git`、`.nuxt`、`.output`、`dist` 和本地数据库目录。
- 环境配置优先阅读 `.env.example`；不要把实际密钥、令牌、连接串或用户数据写入文档与日志。
- 数据库迁移、种子、支付、外部模型调用都可能有真实副作用；不要把它们当作无副作用的代码检查。
- 仅文档修改不需要启动应用、安装依赖、访问外部服务或迁移数据库。结尾说明实际验证了什么、未验证什么。
- 本仓库可在 Windows 上工作；工具的 shell 不一定是 Bash。不要假设分号、POSIX 路径或 Bash 语法可用；优先单命令或当前 shell 支持的 `&&`。

## 2. 项目地图与技术边界

EE 是智能体对话平台。Web 和移动端共享业务契约与同一套 Nuxt/Nitro API，不是两个独立后端。

| 目录                       | 职责与入口                                                   |
| -------------------------- | ------------------------------------------------------------ |
| `packages/webapp`          | Nuxt 4 全栈应用；`app/` 是 Vue 页面，`server/` 是 Nitro 后端 |
| `packages/mobile`          | Ionic + Vue + Vite 前端、Capacitor 原生壳；调用 Web 后端     |
| `packages/commons`         | 共享契约、主题及其他可复用资产；修改前确认实际消费者         |
| `packages/config`          | ESLint、Prettier、Stylelint、TypeScript 等共享配置           |
| `scripts`、`tools`         | 运维/依赖/数据库辅助脚本；不是默认安全初始化入口             |
| `.github/workflows/ci.yml` | CI 的真实步骤与运行版本                                      |

当前核心栈：Vue 3、Nuxt 4、Tailwind CSS 4、Nuxt UI、Ionic/Capacitor、AI SDK 7、Better Auth、Drizzle ORM、PostgreSQL。附件模块另用 `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`（S3 协议，兼容 RustFS / MinIO）。依赖的精确版本查各 `package.json` 和 `pnpm-lock.yaml`，不要根据旧 README 或记忆选择版本。

**共享契约属于 commons 包，不是独立 workspace 包。**

- 实际共享契约是 `packages/commons/src/contract/index.ts`，业务代码使用 `@commons/contract`。
- 共享主题是 `packages/commons/src/styles/theme.css`，通过 `@repo/commons/styles/theme.css` 使用。
- Web 的 `@commons` 别名配置在 `packages/webapp/nuxt.config.ts` 顶层 `alias`（不是 `nitro.alias`，也没有独立 `nitro` 块），指向 `../commons/src`。Nuxt 4 会把顶层 `alias` 一并写入 `tsconfig.server.json`，但**服务端运行时能否解析 `@commons` 尚未经真实构建验证**；当前约定是 `server/` 从不 import 共享契约，`server/utils/billing.ts` 仍本地重复声明 `BillingPeriod`/`Plan`/`MembershipStatus`（与 contract 同名同形，是刻意复制而非依赖）。要在服务端复用契约前，先确认运行时解析确实生效，不要凭别名存在就认定可用。
- `packages/commons/src` 里除 `contract/` 与 `styles/theme.css` 外（`api/ types/ store/ hooks/ utils/ components/ i18n/ router/ services/` 等）均无消费者，是遗留结构；`commons/package.json` 的 exports map 也没有 `./contract` 条目，靠别名访问。修改前先确认实际消费者，不要假定两端已全面接入这些旧目录。
- Mobile 的 `@commons/*` 在 `packages/mobile/tsconfig.json`，Vite 使用 `resolve.tsconfigPaths: true`。
- 根依赖列表很大，不代表所有库都已用于核心链路；不要仅凭依赖名推断功能。

## 3. 常用命令与验证边界

以下命令从仓库根目录执行。根 `package.json` 的 `packageManager` 当前为 `pnpm@12.4.2`；CI 使用 Node 22，但依赖升级后仍需检查各依赖的 engines，不能把 CI 配置视为兼容性证明。

| 命令                                     | 实际作用 / 前提                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm install`                           | 安装 workspace 依赖；`prepare` 会安装 Husky 钩子，可能修改锁文件                  |
| `pnpm webapp:start`                      | 启动 Nuxt Web/API，默认端口 3000                                                  |
| `pnpm mobile:start`                      | 启动移动端 Vite 开发服务；后端仍需单独启动                                        |
| `pnpm webapp:build`                      | Nuxt 生产构建                                                                     |
| `pnpm mobile:build`                      | 执行移动端包的构建脚本；不等于完成原生平台打包                                    |
| `pnpm typecheck`                         | 先 Web 再 Mobile；前者失败会阻止后者执行                                          |
| `pnpm lint`                              | ESLint；覆盖 Web server/app、Mobile src、Commons src                              |
| `pnpm test`                              | Web 的 `smoke-test`，不是双端端到端测试                                           |
| `pnpm --filter @repo/webapp typecheck`   | 仅 Web 类型检查                                                                   |
| `pnpm --filter @repo/mobile typecheck`   | 仅 Mobile 类型检查                                                                |
| `pnpm --filter @repo/webapp icons:check` | 检查图标生成结果是否同步                                                          |
| `pnpm webapp:db:generate`                | 根据 schema 生成迁移文件，会写文件                                                |
| `pnpm webapp:db:migrate`                 | 向目标数据库应用迁移，会改数据结构                                                |
| `pnpm webapp:db:seed`                    | 执行 `server/db/seed.ts`，会写数据库                                              |
| `pnpm webapp:init`                       | 依次 migrate + seed，不是只读环境检查                                             |
| `pnpm webapp:auth:secret`                | 生成 Better Auth 会话密钥（转调 webapp 包同名脚本）；只输出密钥，不写库、不改配置 |

- `webapp:start:pro` 实际仍是 dev；`webapp:build:dev`、`webapp:build:pro` 当前与普通 build 相同，不能据命名假设加载不同环境。
- `pnpm format` 是全仓库 `prettier --write`，`pnpm stylelint` 带 `--fix`；小改动不要用它们制造全仓库格式变更。优先 `pnpm exec prettier --check <文件>`，需要时只格式化本次文件。
- 业务变更按涉及包执行类型检查和构建；改共享代码须考虑双端。检查失败时区分本次回归与既有问题，不通过删代码或削弱检查掩盖失败。
- `packages/webapp/scripts/smoke-test.ts` 主要直接调用模块/断言；数据库不可用可仅警告跳过，局部算法断言也不代表真实接口、计费或数据库事务已通过。
- CI 目前是 install → lint → typecheck → Web build → Mobile build → smoke test。未配置 DB/Redis services，Web build 的环境变量仅在该步骤内设置。

## 4. 环境、数据与危险脚本

- 配置从 `packages/webapp/.env.example` 与 `packages/mobile/.env.example` 了解。先准备本地环境，再执行依赖这些变量的数据库命令；不要照抄 README 中先迁移后配置的顺序。
- Web 的 `nuxt.config.ts` 为 Nuxt Content 配置 PostgreSQL，URL 来自 `POSTGRES_URL`；仅页面内容模块也可能需要数据库，不能假设静态页面构建完全离线。
- `NUXT_DEEPSEEK_API_KEY` 对应私有 `runtimeConfig.deepseekApiKey`；模型供应商还存在数据库配置，不要把所有模型选择简化成一个环境变量。
- 生产运行 `.output/server/index.mjs` 时应由运行环境注入变量，不要假设它会自动读取开发 `.env`。认证及管理员初始密码必须使用真实安全配置；查看 `server/plugins/env-guard.ts` 的约束。
- 跨域配置同时关系到 CORS 和认证可信来源；修改 API 域名、Web 域名或原生回调协议时一起核对，不要只改客户端地址。
- **禁止自动执行** `scripts/update.mjs`：它会清理锁文件/依赖、批量升级、重装并全局格式化。
- **禁止作为常规初始化执行** `tools/db/init.sql`：含 `DROP DATABASE me`。
- README 中旧 schema 升级的 `DROP SCHEMA ... CASCADE` 是破坏性操作，不是解决迁移错误的默认方案。必须先核对目标库、现有迁移与数据保留要求。

## 5. Web / Mobile / 共享代码的修改入口

- Web 路由在 `packages/webapp/app/pages`，管理端在 `app/pages/admin`；Nuxt 文件路由与 Nitro API 文件路由不要混淆。
- Web 聊天页：`packages/webapp/app/pages/chat/[agentId].vue`。
- Mobile 聊天页：`packages/mobile/src/views/ChatView.vue`；路由与导航先从移动端入口及 router 目录定位，不套用 Nuxt 自动路由约定。
- 双端聊天使用 AI SDK 的 `Chat<UIMessage>` 与 `DefaultChatTransport`，请求 `/api/chat`，携带 `agentId`、`conversationId`、`messages`。
- 恢复聊天历史必须保留 `parts`，不能只存/只回填纯文本，否则工具调用和富内容会丢失。
- 移动端普通接口与认证实现集中在 `packages/mobile/src/api/client.ts`：`credentials: include`，存在 token 时附带 Bearer；token 键为 `ee_mobile_token`，并捕获 `set-auth-token` 响应头。`api/auth.ts` 只是它的 5 行再导出 shim，改实现看 `client.ts`。
- `fetchSession()` 带 `AbortController` 超时（约 10s）、并发去重（`inflightSession` 单飞）与模块级 `cachedSession`：网络失败/超时/5xx 等瞬时故障降级返回缓存，**仅 401/403 判定为登出并清缓存返回 null**。因此 `router/index.ts` 的守卫不会因为一次抖动就把已登录用户踢回登录页；冷启动无缓存时仍返回 null。缓存是内部的，未导出 `getCachedSession/setCachedSession`，`signOut()` 会同步清空。改鉴权降级语义时以这段为准。
- 移动端聊天 transport 另行显式设置 Bearer，不直接复用普通 JSON `api()`。更改认证逻辑时两处都要核对。
- 不要把移动鉴权实现描述为“代码严格按浏览器/原生分支”：当前是否发送 Bearer 取决于是否持有 token。
- 修改接口字段、错误归一化、金额/日期/额度格式化时，先读共享契约，再同步服务端响应与两端消费者，避免另造同名类型。
- 主题先改共享语义变量，再查 Web 样式和 Mobile 的 Ionic 映射；不要为单页硬编码一套颜色绕过浅色/深色/品牌色。
- 用户端内容页入口：Web 在 `app/pages/` 下的 `news/`、`notifications.vue`、`attachments.vue`；移动端对应 `src/views/NewsView.vue`、`NewsDetailView.vue`、`NotificationsView.vue`、`AttachmentsView.vue`，导航入口分别在 `TabsView.vue`（底部）与 `HomeView.vue`/`MeView.vue`（顶部与列表）。
- 管理端内容模块页面：`app/pages/admin/news.vue`、`bulletins.vue`、`notifications.vue`、`storage.vue`（存储配置 + 附件总览）；侧栏分组见 `app/layouts/admin.vue` 的 `navGroups`。

## 6. 服务端定位原则

以下路径均相对于 `packages/webapp/`：

| 任务                           | 优先读取                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| 对话编排、流式返回             | `server/api/chat.post.ts`                                                                          |
| 表结构与种子                   | `server/db/schema.ts`、`server/db/seed.ts`                                                         |
| 迁移配置                       | `drizzle.config.ts`                                                                                |
| 数据访问、认证、模型及工具实现 | `server/utils/` 对应模块                                                                           |
| 登录/注册、会话                | `server/api/auth/`、`server/middleware/`                                                           |
| 会话列表与消息历史             | `server/api/conversations/`、`server/api/conversations.get.ts`、`server/api/conversations.post.ts` |
| 管理端资源配置                 | `server/api/admin/` 下 agents/providers/skills/tools/mcp-servers/knowledge-bases 等资源            |
| 套餐、账单、支付               | `server/api/plans.get.ts`、`server/api/billing/`、`server/api/pay/`                                |
| 附件与对象存储                 | `server/api/attachments*.ts`、`server/api/admin/storage*`、`server/utils/storage.ts`               |
| 资讯新闻                       | `server/api/news*`、`server/api/admin/news*`                                                       |
| 宣传栏                         | `server/api/bulletins.get.ts`、`server/api/admin/bulletins*`                                       |
| 消息通知                       | `server/api/notifications*`、`server/api/admin/notifications*`、`server/utils/notify.ts`           |
| 运行时配置保护                 | `server/plugins/env-guard.ts`                                                                      |

- Skill 是注入系统提示词的可复用指令块；Tool 是可执行工具。不能因为旧文档把二者混用就重新合并数据模型。
- MCP 是外部工具来源；修改时关注工具命名、连接生命周期和清理，不能只改管理表单。
- RAG 涉及分块、索引、检索与提示词注入；更换 embedding 模型/维度后须核对历史索引兼容性。
- 生成式 UI 是提示词、组件目录和客户端渲染协作，不是任意服务端 HTML 输出。修改组件 schema 时同步提示词与渲染端。
- 页面路由守卫不能代替服务端鉴权；管理 API 要验证管理员，会话读写要验证所有者。
- 工具、MCP、模型供应商和支付涉及外部调用。维持现有地址校验、超时、鉴权、额度及幂等边界，不为“让测试通过”放开内网访问或关闭认证。

### 主对话链路与数据不变量

`server/api/chat.post.ts` 的实际顺序：鉴权与每用户限流 → 校验请求和启用的 agent → 扣额度 → 加载能力绑定 → 检查/创建会话 → 保存用户消息 → 读取数据库历史 → RAG → 解析模型、工具与提示词 → 流式生成 → 保存 assistant 消息并关闭 MCP。

- 额度按请求次数而非 token 扣减；通过初步校验后、会话归属检查和模型调用前扣额，失败不自动退款。调整顺序会改变业务语义。
- 数据库历史是模型上下文的权威来源。客户端仅能提交落库 user 消息，parts 有白名单；消息主键冲突忽略用于幂等。
- 上下文读取最近 24 条并按 `messages.seq` 排序，裁掉开头非 user 消息，对较早工具输出做压缩。`seq` 为全局 bigserial，不要改成仅按时间排序。
- 生成使用 `streamText` + `stepCountIs(maxSteps)`；输出 UIMessage stream 和 reasoning，结束保存 assistant 消息，中断也保留已生成部分；响应携 `x-conversation-id`。
- `server/utils/providers.ts` 使用 OpenAI 兼容 `.chat()`，不是 Responses API；模型解析可能创建默认 provider 或回填空 key，并非纯读。
- `server/utils/system-prompt.ts` 用 `Intl.DateTimeFormat(..., { timeZone: 'Asia/Shanghai' })` 固定注入北京时间的 `current_date`/`current_time` 与上下文时间行，不依赖运行主机时区；改这里不要退回 `new Date().toLocaleDateString()` 之类主机本地格式化。
- `server/utils/self-config.ts` 修改的是数据库中的全局 agent 及绑定，不是会话私有配置；当前请求已加载的工具集不会因此立即重建。其 `list` 动作返回值会进入模型上下文（tool result），只回传选择/切换所需的 `id`/`name`（及 provider 的 `models`），**不回传 MCP `url`、provider `baseUrl` 等端点**，避免把内部地址或带令牌的查询串透出给模型/日志；新增可回传字段时守住这条边界。
- `server/api/completion.ts` 是独立简化链路，不具备主 chat 的完整配额、历史、agent、工具和 RAG 编排。

### 数据库、检索、支付与认证

- `server/db/schema.ts` 集中定义认证、供应商/智能体/能力绑定、MCP、知识库/文档/分块、会话/消息、套餐/订单/会员/用量表。关系绑定采用复合主键；删除 agent 会级联删除其会话和消息，删除前必须确认影响。
- `server/utils/db.ts` 使用 postgres-js + Drizzle，`prepare: false`；连接本身不执行迁移或 seed。迁移以 `drizzle.config.ts` 与 `server/db/migrations` 为入口，不凭本地代码推断目标数据库已迁移。
- `server/db/seed.ts` 可创建/提升管理员，更新套餐及示例 agent 并补绑定；重跑会覆盖部分配置，不是只补缺。无管理员口令时会生成并打印口令，避免传播日志。
- `server/utils/embedding.ts` 将向量存为 JSONB 数组，在内存做余弦检索，**不是 pgvector**；默认分块 800/100、检索 top-5，向量失败或无命中可降级 Bigram。混合知识库有向量命中时优先向量结果，不是将两种得分直接混排。
- `server/utils/billing.ts` 中金额单位是整数分，额度 `null` 表示不限量，日额度按 UTC+8 划分；条件 upsert 原子扣额。Redis 不是额度账本。
- 会员开通依赖事务、用户级 advisory lock、订单 pending 条件更新及唯一约束保证幂等；续费顺延到期时间。修改支付不能移除这些并发约束。
- 下单金额来自服务端套餐；微信通知需要原始请求体验签。订单查询 GET 会查询支付渠道、补开通或关单，**不是无副作用查询**。
- Mock 支付并非生产绝对禁用：生产显式启用 `MOCK_PAY_ENABLED=true` 后仍可用。不要通过真实或 mock 支付替代普通静态验证。
- `server/utils/auth.ts` 使用 Better Auth 的 `admin()`/`bearer()` 插件；`server/utils/guard.ts` 的 `requireAdmin` 要求 `session.user.role === 'admin'`，`requireUser` 除要求已登录外还会拒绝 `banExpires` 未过期的封禁用户。当前认证在 `advanced` 下显式设 `disableOriginCheck: true`、`disableCSRFCheck: true`（better-auth 1.7 对 POST 强制 Origin 检查，改由 SameSite=Lax 兜底），不能把 trustedOrigins 存在当作这些保护已开启；涉及认证改动需重新评估，本文不是安全验收结论。
- `server/middleware/cors.ts` 已不再向带凭证请求反射 `*`：`resolveOrigins()` 把 `*` 从允许列表剔除、仅记录 `wildcardConfigured` 并一次性告警，只有 origin **显式命中允许列表**才回写 `Access-Control-Allow-Origin`（带 `Vary: Origin`，并 expose `set-auth-token`、`x-conversation-id`），`OPTIONS` 直接 204。允许列表来自 `CORS_ORIGINS` + `BETTER_AUTH_URL` + 默认值。改 API/前端域名或原生回调协议时三处一起核对。
- `server/utils/tools.ts` 的 HTTP 工具调用 `outbound.ts` 的 URL/DNS 校验，15 秒超时、输出截取 4000 字符；`ALLOW_PRIVATE_OUTBOUND=true` 可绕过校验。这不是覆盖 MCP、embedding 等全部请求的全局出站保护。
- Redis 未配置时限流降级单进程内存，缓存回源；不要宣称无 Redis 的多实例部署仍有全局一致限流。原样复制 Web example 会配置 Redis URL，并不等同于禁用 Redis。
- Nitro 自动导入是实际运行约定，不因 handler 缺少显式 `db/createError` import 就判错；独立 tsx 脚本不应假设具备同样环境。
- `/api/agents` 走 `requireUser`（需登录）。首页 `pages/index.vue` 用 `useFetch('/api/agents')` 渲染 agent 精选区，未登录访客拿到 401、`agents` 为空，该区块会静默隐藏——把它当作"数据问题"排查前，先确认访问者是否已登录，或改用不鉴权的公开列表。

### 内容运营与附件模块（资讯 / 宣传栏 / 通知 / 附件）

四个模块的表都在 `server/db/schema.ts` 尾部；共享类型与格式化函数在 `packages/commons/src/contract/index.ts` 的对应小节。

- **迁移现状**：`server/db/migrations/` 目前只有一个已压缩迁移 `0000_smiling_peter_quill.sql`（`_journal.json` 也只有一条 entry），全部 28 张表（含 content-ops/附件/订单/存储配置）都在其中。不要假设存在按模块拆分的 `0002_*` 迁移；核对目标库是否已迁移以 `drizzle.config.ts` 与该目录为准。

- **链接/时间归一集中在 `server/utils/content-ops.ts`**：`normalizeLink()` 拒绝协议相对(`//`)、只放行 http/https 绝对地址或以 `/` 开头的站内路径（管理员通知 `linkUrl`、宣传栏链接都走它，避免存下 `javascript:`/协议相对 XSS）；`parseDateInput()` 统一解析活动/通知时间并抛 400。消费者是 `admin/bulletins*` 与 `admin/notifications`。`news`/`storage` 未用。改这类校验改这一处，不要在各 handler 里各写一份。

- **附件是 S3 协议，不是本地磁盘**。`server/utils/storage.ts` 是唯一适配层，面向 RustFS / MinIO / AWS S3 等；自建存储默认 `forcePathStyle=true`。改存储行为时改这一处，不要在各 handler 里各写一套。
- **两类上传通道都要保留**：服务端中转 `POST /api/attachments`（兼容未配 CORS 的桶）与前端直传 `POST /api/attachments/presign` + `/complete`。直传又分 PUT 预签名与 `mode=post` 预签名 POST policy 两种。直传的 `complete` 会校验 objectKey 必须落在当前配置 prefix 下且不含 `..`，否则用户可以"认领"任意已存在对象。
- **中转上传有硬上限**（`RELAY_UPLOAD_HARD_LIMIT_MB=64`）：`readMultipartFormData()` 会把请求体读进内存，因此 `assertRelayRequestAllowed()` 在解析前按 Content-Length 拒绝，解析后 `assertRelayPayloadSize()` 兜底。调大上限前先确认内存占用。
- **私有桶返回预签名 URL**（默认 1 小时，`DEFAULT_PRESIGN_EXPIRES=3600`），配置 `publicBaseUrl` 时改走公共地址；`presignDownload` 只在本地签名（`getSignedUrl`），不产生存储侧请求。脱敏要看清方向：`sanitizeStorageConfig()` **直接丢弃** `secretAccessKey`、只回传 `accessKeyIdPreview`（形如 `AKIA****`）与 `hasCredentials`，**响应里根本没有 `********`**；`********`（`SECRET_PLACEHOLDER`）只是 admin 存储 PATCH/test 的**请求侧**「保持原密钥不变」哨兵值，管理 UI 在留空时压根不发该字段。不要把这两者混为一谈。
- 附件列表的 `stats` 按用户全量统计，**不随 category/keyword 筛选变化**；管理端存储列表用一次聚合查询带出各配置占用（避免 N+1）。
- **通知的受众语义**：`audience=all` 不预展开收件人（含未来注册用户），`users` 在创建时展开。因此广播的 `targetCount` 用当前用户总数当分母，会随时间增长而下降，这是正确表现。`markNotificationsRead()` 只对当前用户可见的通知写入已读记录，改动时不要绕过该可见性过滤。
- **宣传栏的时间窗**：结束日期取当天 23:59:59.999（`dateInputToBoundary(value, 'end')`），不是当天 00:00——否则选到当天的活动会在当天上午提前下线。`isBulletinActive()` 目前只在管理端 `admin/bulletins.vue` 调用来做"进行中/已结束"标注；两端 `BulletinBanner.vue` 依赖的是服务端 `bulletins.get.ts` 的时间窗过滤，不在前端再判一次。改活动可见性时以服务端过滤为准。
- **资讯浏览量按 (用户, 文章) 30 分钟去重**：Redis 可用时跨实例生效，否则降级进程内 Map。详情页用 `useAsyncData` 承载首屏，避免 SSR 后客户端二次请求。
- 用户端 `/news`、`/notifications`、`/attachments` 与移动端同名路由都需要登录；管理端在 `/admin/news`、`/admin/bulletins`、`/admin/notifications`、`/admin/storage`。`/admin/storage` 页面同时承载存储配置与附件总览。
- 移动端未读角标用 `packages/mobile/src/composables/useUnread.ts` 的共享单例，不要在页面里各自维护未读数，否则读完消息返回后角标不同步。
- 移动端拍照上传走 `@capacitor/camera`（仅原生壳展示入口，动态导入因此只进附件分包）；仓库内暂无 android/ios 原生工程，接入原生构建时需另行声明相机权限。
- **直传的体积上限由登记接口兜底**：S3 的 PUT 预签名 URL 无法携带 `content-length-range`，因此客户端自报的 size 不可信。`/api/attachments/complete` 会回源 `HeadObject` 读真实大小，超限则删除对象并拒绝登记；另有 `mode=post` 的预签名 POST policy 可在上传阶段直接拒绝。改动直传链路时不要绕过这一步校验。

### 前端约定与易错点

- **i18n 消息不能直接写 `{{x}}`**：vue-i18n 把它当插值语法，渲染时抛 `Not allowed nest placeholder` / `Invalid token in placeholder`。字面量大括号要写成 `{'{{'}…{'}}'}`；JSON 示例这类代码片段应放在组件内拼接，不要进 locale。改动 locale 后建议对每条消息做一次编译校验（`zh-CN`/`en-US` 与移动端两份都要查）。
- **模板里不要用会遮蔽 i18n `t` 的循环变量名**：`v-for="t in list"` 会让同一模板内的 `t('...')` 变成「对象不可调用」。循环变量用具体名词（如 `tool in toolList`）。
- **管理端页面需同时处理 loading / 错误 / 空态三种状态**：失败时若直接套用空态文案，用户会把「接口挂了」读成「没有数据」。列表页失败应清空数据并渲染错误提示 + 重试按钮。
- **订单状态展示统一走共享契约，不要再复制**：`@commons/contract` 的 `orderStatusTone(status)` 返回 `app-badge-*` 类名、`orderStatusLabelKey(status)` 返回 i18n 键；`pricing.vue`、`profile.vue`、移动端 `MembershipView.vue`、`MeView.vue` 都 `t(orderStatusLabelKey(...))`。此前各页自写 `statusTone`/`orderStatusText` 会把 `refunded` 误显示成「已关闭」，已收敛。前提是两端 locales 的 `billing` 段都含四个 `status*` 键（含 `statusRefunded`）。注意 webapp `billing` 比 mobile 多 5 个当前未被 mobile 引用的键（`sandboxDesc`/`scanQrCode`/`mockPayHint`/`mockPayConfirm`/`payPending`）；mobile 若将来复用这些文案，先补两份 locale 再引用。
- **页面内的 `setTimeout`/`setInterval` 必须在卸载时清理**：搜索防抖与成功提示定时器若不清，SPA 内快速进出页面会在组件销毁后继续发请求或写状态。**注意：目前并没有集中的 `flashSuccess()`**——`admin/notifications.vue`、`admin/storage.vue`、`pages/attachments.vue`、`pages/notifications.vue` 与移动端 `AttachmentsView.vue`、`NotificationsView.vue` 各有一份本地 `flashSuccess`/`success` 定时器实现。凡直接 `success.value = …` 绕过本地辅助函数的写法，提示不会自动清理；收敛这类重复或新增 toast 时，把定时器登记到可清理处是优先方向。
- 修改共享契约后同步两端；`pnpm lint` 覆盖 Web server/app、Mobile src 与 Commons src，`.husky/pre-commit` 只跑 lint-staged（不含 Vue 的 ESLint），提交成功不等于通过检查。

### 服务端健壮性约定

- **无鉴权接口不得有副作用**：`/api/health` 是公开探针，模型检查必须走只读的 `peekModelAvailability()`，不要调 `resolveModel()`——后者会触发 `ensureDefaultProvider()` 写库。探针也不应回传供应商地址、数据库错误原文或运行环境信息。
- **分页参数一律夹到合法区间**：`limit`/`offset` 的负数会被 PostgreSQL 拒绝（2201W/2201X）并把 SQL 细节透出到响应体，`page=Infinity` 会让 offset 溢出。统一用 `Math.min(Math.max(1, ...), 上限)` 与 `Math.max(0, ...)`。
- **入参要防御 `undefined`**：`readBody` 对空请求体返回 undefined（解构即 500）；聊天请求的 `messages[].id` 缺失会让 drizzle 传 undefined 参数（同样 500，且额度已扣）。服务端应为缺失的主键补值，而不是依赖客户端。
- **落库前校验 part 结构**：相对路径的 `file`/`image` part 会因 AI SDK 的 `new URL()` 抛错而让该会话**永久** 500（历史来自数据库，每轮都会重放）。`sanitizeUserParts()` 现在会校验 url 必须是绝对 http(s)/data 地址。
- **多行写入要考虑事务**：文档行与分块行、默认存储切换的两条 update，失败时会留下不一致状态，需同事务执行。
- **统计避免全表拉取**：计数用 `count(*) GROUP BY`，不要在应用层把整表查进内存再 filter；列表里的关联数据用一次 IN 查询后分组，避免 N+1。

### 前端配套与代码风格

- Mobile 路由入口是 `packages/mobile/src/router/index.ts`，主导航为 `/tabs/home`、`/tabs/membership`、`/tabs/me`；聊天为 `/chat/:agentId`，微信回调为 `/wechat-callback`。
- Mobile Vite 的 `/api` dev/preview 代理读取 `API_PROXY_TARGET`（默认 localhost:3000）；代理不会随生产静态包发布。原生本地 dist 使用 `VITE_API_BASE` 配后端；`CAPACITOR_SERVER_URL` 则让 WebView 加载远端页面。保留 Vite 的 `vue-router` dedupe，避免 Ionic 与应用持有不同路由实例。
- 双端生成式 UI 映射分别在 `packages/webapp/app/utils/json-ui.ts` 与 `packages/mobile/src/components/json-ui.ts`；Web 消息组件为 `packages/webapp/app/components/ChatMessage.vue`。
- i18n 入口分别是 `packages/webapp/app/plugins/i18n.ts`、`packages/mobile/src/i18n.ts`，翻译在各自 locales 目录；不要因 commons 有旧 i18n/api/store 就假设两端已全面接入它们。
- Prettier 配置在 `packages/config/src/prettier/prettier.config.mjs`：4 空格、单引号、分号、尾逗号、宽度 160、LF；插件可能重排 imports 和 Tailwind class。
- `.husky/pre-commit` 只执行 lint-staged，不执行 typecheck/test；其 ESLint 文件模式不含 Vue，不能以提交成功代替完整检查。
- `packages/webapp/app/utils/app-icons.ts` 是生成文件。新增图标应改 `packages/webapp/scripts/generate-icons.mjs` 的 NAMES，再运行 `pnpm --filter @repo/webapp icons`，不要手改生成结果。

## 7. 已知文档/配置偏差（静态核实，不是本次修复项）

1. 根 pnpm 声明是 12.4.2，CI 显式安装 12.4.1；依赖/CI 任务应一起核对，不在普通业务或文档任务中顺手更改。
2. README 的“冒烟测试含 DB 连通性”不意味着测试成功时 DB 一定可用；该脚本可跳过数据库检查。

## 8. 快速导航与最小阅读范围

开始任务时先读本文对应章节，再按下列入口读取实现及直接消费者。路径存在不代表实现已通过运行验证；不要为了理解一个页面重新扫描全部 packages。

### 常见任务从哪里开始

以下路径均相对仓库根目录：

| 任务                         | 首选入口与联动文件                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 修改智能体管理字段或能力绑定 | `packages/webapp/app/pages/admin/agents.vue` → `packages/webapp/server/api/admin/agents/[id].patch.ts` → `packages/webapp/server/utils/agent-skills.ts`；新增持久化字段再查 `packages/webapp/server/db/schema.ts`                                                                                            |
| 修改其他管理资源             | 从 `packages/webapp/app/pages/admin/` 对应页面进入 `packages/webapp/server/api/admin/`；知识库页面为 `knowledge.vue`、API 为 `knowledge-bases`，MCP 页面为 `mcp.vue`、API 为 `mcp-servers`，不要假设名称相同                                                                                                 |
| 修改移动端页面或导航         | `packages/mobile/src/router/index.ts` → `packages/mobile/src/views/` 对应页面；底部导航在 `TabsView.vue`，会员在 `MembershipView.vue`，个人中心在 `MeView.vue`                                                                                                                                               |
| 修改登录、会话与跨域         | Web 的 `packages/webapp/app/composables/useSession.ts`；Mobile 的 `packages/mobile/src/api/client.ts` 与 `packages/mobile/src/api/auth.ts`；后端联查 `packages/webapp/server/utils/auth.ts`、`packages/webapp/server/utils/guard.ts`、`packages/webapp/server/middleware/cors.ts`                            |
| 修改生成式 UI 组件或 schema  | `packages/webapp/server/utils/catalog.ts`、`packages/webapp/server/utils/system-prompt.ts`；同步两端 `json-ui.ts` 映射及 Web 的 `packages/webapp/app/components/json-ui/`、Mobile 的 `packages/mobile/src/components/Jr*.vue`                                                                                |
| 修改知识库上传、分块或索引   | `packages/webapp/server/api/admin/knowledge-bases/[kbId]/documents.ts` → `packages/webapp/server/utils/embedding.ts`；重建入口为同目录的 `reindex.post.ts`，对话检索消费者为 `packages/webapp/server/api/chat.post.ts`                                                                                       |
| 修改套餐、会员或订单展示     | Web 的 `packages/webapp/app/pages/pricing.vue`、`packages/webapp/app/pages/profile.vue`；Mobile 的 `MembershipView.vue`、`MeView.vue`；订单状态徽章/文案统一用契约 `orderStatusTone`/`orderStatusLabelKey`；联查共享契约、`packages/webapp/server/api/billing/` 和 `packages/webapp/server/utils/billing.ts` |
| 修改主题或语言               | 两端各自的 `useTheme.ts`、i18n 入口及 locales；主题令牌源为 `packages/commons/src/styles/theme.css`，不要从旧 commons 业务目录推断实际消费者                                                                                                                                                                 |
| 修改图标、格式或检查规则     | 图标从 `packages/webapp/scripts/generate-icons.mjs` 修改；共享检查规则在 `packages/config/src/`，命令范围看根 `package.json`，实际 CI 看 `.github/workflows/ci.yml`                                                                                                                                          |
| 修改附件 / 对象存储          | `packages/webapp/server/utils/storage.ts` → `packages/webapp/server/api/attachments*`（上传/直传/下载代理）→ 用户端 `packages/webapp/app/pages/attachments.vue` 与移动端 `packages/mobile/src/views/AttachmentsView.vue`；管理端 `packages/webapp/app/pages/admin/storage.vue`                               |
| 修改资讯新闻                 | `packages/webapp/server/api/news*`、`packages/webapp/server/api/admin/news*` → Web 的 `app/pages/news/`、`app/pages/admin/news.vue` 与移动端 `NewsView.vue`、`NewsDetailView.vue`；契约 `NewsSummary`/`NewsDetailResponse`                                                                                   |
| 修改宣传栏                   | `packages/webapp/server/api/bulletins.get.ts`、`packages/webapp/server/api/admin/bulletins*` → 两端 `BulletinBanner.vue` 与管理端 `admin/bulletins.vue`；时间窗边界用契约的 `dateInputToBoundary()`                                                                                                          |
| 修改消息通知                 | `packages/webapp/server/utils/notify.ts`、`server/api/notifications*`、`server/api/admin/notifications*` → Web 的 `app/pages/notifications.vue`、`admin/notifications.vue` 与移动端 `NotificationsView.vue`；移动端未读角标走 `composables/useUnread.ts`                                                     |

### 阅读实现时不能跳过的边界

- 管理接口可能使用不带方法后缀的文件并在内部按 HTTP 方法分支，例如知识库 `documents.ts`；不要只搜索 `.post.ts` 就认定上传接口不存在。
- 智能体创建/更新已把主表写入与四类能力绑定（`replaceAgent*`）收进同一个 `db.transaction`，通过 `agent-skills.ts` 的 `DbRunner`（默认 `db`）把事务句柄传下去；`[id].patch.ts` 在主表 0 行更新时先抛 404 再动绑定。改动时保持这一事务边界，不要退回"多次独立写"。
- 管理端 `providers` 成为默认、`mcp-servers` 创建/改名走同一事务：providers 用事务清除其他默认，MCP 用 `pg_advisory_xact_lock(hashtext(name))` 包住查重+写入并把冲突降到 409；`mcp-servers/[id].ts` 仅在改名时才进事务，普通字段走非事务 update。`baseUrl`/`url` 统一经 `assertAbsoluteHttpUrl()`（要求绝对 http/https，`outbound.ts` 提供）。
- 知识库上传当前将文件按 UTF-8 文本解码，multipart 文件限制为 2MB；不是通用 PDF/Word 解析入口。JSON 上传分支单独处理，不可将文件分支的限制当作两种输入都已覆盖。
- 文档上传会调用 embedding 供应商；失败可保存空向量并将文档标记为 `ready`。因此 `ready` 不等于向量生成成功，也不代表上传是无外部副作用操作。
- `catalog.ts` 定义 Card、Stat、Badge、Alert 的模型输出 schema。即使注释声称共用目录，也应检查客户端实际导入和注册方式；新增组件须同步提示词、属性定义和双端渲染。
- 移动路由守卫读取的 `fetchSession()` 已缓存降级（见 §5）：瞬时故障保留上次会话、仅 401/403 判登出，微信回调路由单独放行且回跳页 `sync()` 可重试，不要把回调跳转只当作路由配置问题而忽略 token 接收与 `apiUrl` 域名。Ionic 标签页组件切换时保活，`HomeView` 用 `onIonViewWillEnter` 而非仅 `onMounted` 刷新，改其他常驻标签页时同理。

### 最小验证与知识更新

- 文档修改：核对新增路径和描述，针对文档执行格式检查及 `git diff --check`；不启动应用、数据库或外部服务。
- 页面或共享契约修改：检查直接消费者及对应包类型；涉及共享代码则检查双端，不用单端通过代表双端通过。
- API、schema 或业务链路修改：区分静态检查、模块测试、真实 HTTP/数据库验证；执行会写数据或调用外部服务的验证前先确认环境与授权。
- 记录稳定约束与入口，不记录一次性 lint 报错为永久事实。任务结束总结实际改动、已验证范围和未验证边界；不要为了让检查通过扩大到无关修复。

## 9. 如何维护这份知识

- 优先更新稳定事实：模块职责、契约位置、关键链路、命令前提与副作用、常见陷阱。
- 不写入临时分支、单次报错、机器绝对路径、密钥或一次性的测试通过结论。
- 修改 package scripts、共享别名、认证方式、数据库初始化或聊天协议时，同步更新对应章节。
- 不需要把所有 API 和组件抄进本文。遵循“本文定位 → 阅读相关实现 → 最小修改 → 针对性验证”的顺序。
