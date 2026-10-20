# work 第二轮精简评估

> 评估日期：2026-10-20
> 基线：`67590f7 refactor(work): 精简重复 API 与未使用代码`
> 范围：`packages/work`，只评估“还能不能继续变小”，本轮**不删除任何代码**。

## 1. 结论

第一轮已经拿掉了确定无用的代码：3 个 307 别名端点、5 个无引用导出、9 个 Drizzle relations、`@tiptap/*` 直接依赖，共 **-165 行**，构建从 17.4MB 降到 15.9MB。

第二轮继续按“删文件”推进的收益已经很小，而且几乎每一条都会碰到**能力取舍**，不再是纯代码清理：

- 当前 `packages/work` 约 **238 个 TS/Vue 文件、30,521 行**，其中 server 15,395 行、app 13,314 行、scripts 1,707 行。
- 有 **78 个 API 路由文件、28 张表、21 个页面、13 个组件、65 个 server utils**。对单主本机应用来说，复杂度主要来自**功能面**，不是重复代码。
- 没有 UI 消费者的 API 只剩少数几个；最大的可删块是会话 API v2 的未使用端点（约 241 行）和 NDJSON 单表游标（约 100 行）。
- 默认关闭的 jobs / 子代理 / web 工具 / 本地写入并不是“死代码”，它们由环境变量显式启用；删掉会直接减少可选能力。

**建议**：第二轮只做 `R2-2` 这一项低风险清理（约 100 行）；把会话 API v2 的删除（`R2-3`）作为需要确认的契约变更单独决策。`R2-1` 经核对**不能删**——它和 `GET /api/conversations/{id}` 的口径不同，删掉会失去唯一的压缩感知读路径。不要为了行数去动事件源、知识库、定时任务和聊天主链路。

## 2. 现状量化

### 2.1 功能面

| 能力                  | 用户入口                  | 默认状态                        | 估算代码量 | 评估 |
| --------------------- | ------------------------- | ------------------------------- | ---------: | ---- |
| 聊天主链路 / 后台生成 | `/`、`/chat/*`、`/agents` | 核心                            |     ~3,070 | 不动 |
| 事件源会话 / 压缩     | 聊天、时间线              | 核心                            |       ~920 | 不动 |
| 定时任务 / 运行记录   | `/tasks`、`/runs/*`       | 核心                            |     ~2,020 | 不动 |
| 知识库 / RAG          | `/library`、设置 → 知识库 | 核心                            |     ~2,480 | 不动 |
| 工作空间              | `/spaces`                 | 核心                            |          — | 不动 |
| 附件 / 对象存储       | 聊天附件、设置 → 存储     | 核心                            |          — | 不动 |
| 备份 / 导入           | 设置 → 存储               | 核心                            |       ~840 | 保留 |
| 技能                  | 设置 → 技能               | 可用                            |       ~490 | 保留 |
| MCP                   | 设置 → MCP                | 可选                            |       ~720 | 保留 |
| 审批                  | 聊天审批卡                | 核心（ask 模式）                |       ~330 | 不动 |
| 交付物 / 时间线       | 聊天右侧栏                | 核心                            |       ~420 | 不动 |
| 命令 / 后台作业       | `/jobs`                   | `WORK_COMMAND_ENABLED=1` 才启用 |       ~570 | 保留 |
| 子代理                | 无独立 UI，模型工具       | 动态加入                        |        ~82 | 可选 |
| 网页抓取 / 搜索       | 无独立 UI，模型工具       | `WEB_TOOL_ENABLED=1` 才启用     |       ~245 | 保留 |

### 2.2 没有 UI 消费者的接口

在 `app/` 下检索 `/api/sessions`，只命中时间线的 `GET /api/sessions/{id}/events`；其余会话 v2 端点没有前端调用。`/api/conversations/{id}/messages`、`/api/metrics/rate-limit`、`/api/tools/metrics` 也没有 UI 调用。

这不等于“可以删”：它们可能是给脚本、未来客户端或运维用的。`conversations/{id}/messages` 还和 `conversations/{id}` 的口径不同（压缩感知），见 R2-1。其余是当前最明确的**低使用面**。

## 3. 候选清单

### R2-1 消息读取端点：不能按“重复接口”删除（本轮不做）

**文件**：`server/api/conversations/[id]/messages.ts`（26 行）

**初看像重复**：`GET /api/conversations/{id}` 已经返回 `messages`。但两个口径不同：

- `GET /api/conversations/{id}` 直接读 `messages` 表最近 N 条（`[id].ts`）。
- `GET /api/conversations/{id}/messages` 走 `loadConversationContext()`：默认也读 `messages`，但**存在压缩标记时改为事件投影，旧区间被摘要遮蔽**。

**结论**：删掉它会失去唯一的“压缩感知”读路径，而且会让“UI 看到的完整历史”和“模型实际看到的摘要历史”差异更大。当前没有 UI 调用它，是一个**未接线的正确读路径**，不是死代码。

**真正该做的**（另开任务，不属于精简）：评估 `ChatPane` 加载历史时是否应改用这个端点，或至少在压缩后给用户一个“更早消息已被摘要”的提示。删除不是解法。

### R2-2 删除 NDJSON 单表游标分页（建议执行）

**文件**：

- `server/utils/backup-pages.ts`（71 行，整个文件）
- `server/api/export/ndjson.get.ts` 中 `?table=&after=&limit=` 分支（约 30 行）
- `scripts/smoke-test.ts` 中 `buildBackupPage` 的 3 条断言
- 文档中“单表游标分页”的说明

**保留**：整机 NDJSON 导出（`/api/export/ndjson` 无参数）与整机 NDJSON 导入（`/api/import/ndjson`）不变，设置页的两个按钮不变。

**证据**：UI 的 NDJSON 导出是 `<a href="/api/export/ndjson">`，从不带 `table/after/limit`；单表分页也没有任何客户端。`backup-import-ndjson` 本来就只接受整机导出，单表分片会 400。

**影响**：失去“只导某张表的一页”这个未使用的接口能力；整机备份不受影响。

**风险**：低。需要同步删 smoke 断言，否则测试会红。

**验收**：`pnpm --filter @repo/work test` 的备份段通过；`curl /api/export/ndjson` 仍返回 `meta → table/row/tableEnd → end`。

### R2-3 删除会话 API v2 的未使用端点（需要确认）

**文件**：

| 文件                                       |    行数 |
| ------------------------------------------ | ------: |
| `server/api/sessions/index.ts`             |      64 |
| `server/api/sessions/[id]/snapshot.get.ts` |      37 |
| `server/api/sessions/[id]/follow.get.ts`   |      50 |
| `server/api/sessions/[id]/fork.post.ts`    |      90 |
| **合计**                                   | **241** |

**保留**：`server/api/sessions/[id]/events.get.ts`（时间线仍在用）与 `conversations/[id]/messages.ts`（压缩感知读路径，见 R2-1）。

**影响**：这会移除“会话列表/创建、按 seq 快照、SSE 跟随、从 seq 分叉”四项 API 能力。它们没有 UI，但属于 P3-1 的对外契约；如果只按“UI 用不到”删除，下一次要做 headless 客户端/回放工具时得重写。

**风险**：中。需要同步改 `AGENTS.md`、`dsh-alignment-plan.md` 的 P3-1 描述，并明确“work 只保留 events 读路径”。

**判断**：如果目标是**能力不变**，不做。如果确认没有外部调用、也接受 API 收缩，这是第二轮最大的一块可删代码。

### R2-4 运维指标端点（不建议单独做）

**候选**：`server/api/metrics/rate-limit.get.ts`、`server/api/tools/metrics.get.ts`，以及 `rate-limit.ts` / `tool-registry.ts` 内的指标累加。

**收益**：最多约 80–120 行。

**问题**：限流本身要保留，指标只是附着在里面的少量计数；单独删端点会让 `rateLimit()` 的 `blocked/memoryFallback/redisErrors` 失去观察面，收益太小。

**判断**：不做。

### R2-5 默认关闭的能力包（不建议在“精简”名义下删）

| 能力                   | 代码量 | 删掉的代价                     |
| ---------------------- | -----: | ------------------------------ |
| jobs / run_command     |   ~570 | 失去本机命令执行与后台作业页   |
| MCP                    |   ~720 | 失去外部工具服务器接入与设置页 |
| 子代理                 |    ~82 | 失去只读子任务                 |
| web_fetch / web_search |   ~245 | 失去联网工具                   |
| 本地文件写入           |      — | 失去 `WORK_FILE_WRITE` 能力    |

这些能力默认关闭，**不配置时没有运行时成本**。它们的成本是代码维护面，不是启动开销；删掉属于产品取舍，不是代码清理。

## 4. 架构级候选（本轮不做）

### 4.1 去掉 `@nuxt/ui`，只保留 color-mode

work 的 `app/assets/css/main.css` 直接 `@import '@nuxt/ui'`，但页面几乎没有 `U*` 组件，`useTheme` 只用到 `useColorMode()` 和 `--ui-color-primary-*` 变量。理论上可换成 `@nuxtjs/color-mode` + 最小主题变量，减少整包 UI 组件与样式。

**收益**：构建产物体积和依赖面可能明显下降。
**风险**：高。主题、深浅色、表单基础样式都依赖 Nuxt UI 的 CSS 变量；没有浏览器级视觉回归，不适合在“精简”里顺手做。

### 4.2 去掉事件源或 RAG

事件源（~920 行）和知识库/RAG（~2,480 行）是当前 work 的核心差异能力，不是重复实现。删掉会让项目回到普通聊天壳，不能算精简。

## 5. 推荐顺序

1. **先做 R2-2**：约 100 行、2 个文件，能力损失仅限“未使用的单表导出分页”，风险低，能保持现有 UI 完全不变。
2. **单独确认 R2-3**：如果明确没有脚本/外部客户端调用会话 v2，再删 4 个端点（约 241 行）；否则保留。
3. **R2-1 不做**：它是压缩感知读路径，不是重复接口；是否接入 UI 是另一个功能问题。
4. **R2-4 / R2-5 不做**：收益低于维护成本，或属于产品取舍。
5. 若目标是“构建体积/依赖面”而不是行数，另开一项评估 4.1，不和本轮混在一起。

## 6. 验收清单（执行 R2-2 时）

- `pnpm --filter @repo/work typecheck`
- `pnpm exec eslint packages/work/server packages/work/app --ext .ts,.vue`
- `pnpm --filter @repo/work test`（当前基线 243 项通过；删 `buildBackupPage` 断言后数量会下降，不能把数量变化误判为回归）
- `pnpm --filter @repo/work build`
- `pnpm install --frozen-lockfile`
- 手工/接口确认：`GET /api/conversations/{id}` 仍返回消息；`GET /api/export/ndjson` 整机导出仍以 `end` 收尾；设置页“导出 NDJSON / 导入 NDJSON”可用。
- 不需要数据库迁移；28 张表与备份版本 5 不变。

## 7. 决策点

本轮评估的结论是：**work 已经没有大规模“无风险可删代码”**。要继续明显变小，只能在下面两条里选：

- **保能力**：只执行 R2-2，接受“精简到此为止”（约 100 行）。
- **收缩 API**：额外执行 R2-3，接受会话 v2 从对外能力中移除（再约 241 行）。

`conversations/[id]/messages.ts` 不在这两条里：它不是重复接口，删掉会丢失压缩感知读路径。要让它“有用”，应评估接入聊天历史，而不是删除。

在没有确认 R2-3 之前，不建议删除 jobs、MCP、子代理、web 工具或任何核心链路。
