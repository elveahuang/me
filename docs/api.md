# 客户端 API 参考

webapp 服务端同时为 webapp、mobile（Ionic）以及未来的小程序客户端提供接口。所有业务接口都支持两种鉴权方式，客户端实现时**不需要为不同端单独设计协议**。

## 鉴权

| 方式 | 客户端 | 说明 |
|---|---|---|
| Cookie 会话 | webapp | better-auth 默认 cookie（`better-auth.session_token`），登录接口自动设置 |
| Bearer Token | mobile / 小程序 | 登录响应中的 `token`，请求头 `Authorization: Bearer <token>` |

- 登录：`POST /api/auth/sign-in/email`（body: `{ email, password }`）→ `{ token, user }`
- 注册：`POST /api/auth/sign-up/email`（body: `{ name, email, password }`）→ `{ token, user }`
- 当前用户：`GET /api/me` → `{ user: { id, name, email, role, image } }`
- 登出：`POST /api/auth/sign-out`
- 统一错误结构：`{ "error": "中文错误描述" }`，配合对应 HTTP 状态码（401 未登录 / 403 无权限或封禁 / 402 配额用尽 / 404 不存在 / 429 限流）。
- CORS：白名单见 `packages/webapp/src/lib/cors.ts`，生产环境用 `CORS_ORIGINS` 环境变量覆盖（新增小程序客户端时把其请求来源加入即可）。

## 对话

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/agents` | 可用智能体列表 |
| POST | `/api/chat` | 流式对话（SSE，AI SDK UI message stream）。请求体 `{ agentId, conversationId?, messages }`；响应头 `x-conversation-id` 回传会话 ID |
| GET | `/api/conversations` | 我的会话列表 |
| GET | `/api/conversations/:id` | 会话消息详情 |
| DELETE | `/api/conversations/:id` | 删除会话 |

**配额**：每次成功发起对话消耗 1 次当日配额。超出套餐额度返回 **402**，`error` 中含升级提示；客户端应引导跳转套餐页。额度受会员套餐控制（见下）。

## 会员与支付

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/plans` | 套餐列表 + 可用支付渠道 `{ plans, providers: [{ code, available }] }` |
| GET | `/api/billing/membership` | 当前会员状态 `{ plan, expiresAt, chatQuotaPerDay, usedToday }` |
| POST | `/api/billing/orders` | 创建订单，body `{ planId, period: 'monthly'\|'yearly', provider? }` → `{ orderNo, mode, payUrl?, jsapiParams?, ... }` |
| GET | `/api/billing/orders/:orderNo` | 订单状态（轮询）：`pending / paid / closed / refunded` |
| GET | `/api/billing/orders` | 我的订单（最近 50 条） |
| POST | `/api/billing/orders/:orderNo/mock-pay` | **仅 mock 渠道**：模拟支付成功（开发联调用） |

**支付方式（`mode`）**：
- `mock`：开发环境（未配置微信支付凭据时自动兜底），创建订单后调 `mock-pay` 即完成支付；
- `qrcode`：微信 Native 支付，`payUrl` 为二维码内容，前端渲染二维码并轮询订单状态；
- `jsapi`：微信内公众号支付，`jsapiParams` 直接传给 `WeixinJSBridge.invoke('getBrandWCPayRequest', ...)`；
- `redirect`：预留（H5 支付）。

**渠道抽象**：服务端 `src/lib/payments/`（`PaymentProvider` 接口 + wechat/mock 实现），新增支付宝等渠道只需新增实现并在 registry 注册，客户端通过 `providers` 字段自动发现。

## 微信公众号登录

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/wechat/status` | `{ enabled }`：是否配置了公众号凭据（登录页据此显示微信按钮） |
| GET | `/api/auth/wechat?redirect=/chat` | 发起公众号网页授权（仅微信内浏览器），成功后 302 回跳并写入会话 Cookie |
| GET | `/api/auth/wechat/callback` | 微信回调（`MOBILE_APP_URL` 配置后支持 302 回移动端并以 `#token=` 携带会话 token） |

微信登录用户与邮箱密码用户共用同一账号体系（`account.provider_id = 'wechat'`，`account_id` 为 openid）；绑定后 JSAPI 支付可直接取到 openid。

## 管理端（仅 admin 角色）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/plans` | 套餐列表（含未上架）/ 新建 |
| PATCH/DELETE | `/api/admin/plans/:id` | 编辑 / 删除（有订单引用时只能下架） |
| GET | `/api/admin/orders` | 全站订单（最近 200 条，含用户邮箱） |
| GET/POST | `/api/admin/agents`、`/api/admin/skills`、`/api/admin/tools`、`/api/admin/knowledge`、`/api/admin/mcp`、`/api/admin/providers`、`/api/admin/users`、`/api/admin/stats` | 既有管理接口，见各路由文件 |
