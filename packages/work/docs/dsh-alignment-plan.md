# packages/work × DSH 能力对齐与整改方案

> 范围：`packages/work` 现状解读、DSH（DeepSeek Harness）能力映射、差距清单、分阶段整改项与验收标准。
> 性质：分析与整改方案。**P0、P1 全部完成；P2 全部完成；P3-1/P3-2/P3-3/P3-4/P3-5/P3-6 均有落地但仍余加固项；P4 已做密钥加密（供应商/存储/MCP headers）、进程内限流指标、本机负载基线与空库迁移演练**（执行状态与验证见 0.1）。
> 依据：仓库当前源码（2026-10 工作区）、`AGENTS.md`、DSH 0.2.1-rc.2 的 302 个包 README（下文以 `@deepseek-ai/<包>/README.md` 引用）。
> 结论先行：**不要整体引入 Cordis/DSH 作为运行时依赖**；按 DSH 的语义在 Nuxt + AI SDK + PostgreSQL 上做“事件源会话 + 受控工具运行时”，分四期落地。

---

## 0. 结论摘要

1. **work 的“壳”已经相当完整**：空间、智能体、技能、工具、MCP、知识库、附件、自动化、运行中心、资料库、设置、命令面板、生成式 UI 都有；安全上也做了回环绑定、Origin 写保护、SSRF 防护、限流、备份脱敏、北京时间口径与运行历史。它的问题不是“功能少”，而是**运行时缺少可恢复的会话状态、上下文治理和工具执行策略**。
2. **最关键的差距只有一条**：会话的唯一真相仍是 `messages` 表里“一轮一条”的消息，生成中的状态在内存（[chat-runs.ts](../server/utils/chat-runs.ts)）。P1-1/P1-2 已补上 append-only 事件、运行边界与工具审计（见 0.1），但**读路径仍未切换**，也还没有压缩、token 预算与崩溃后的工具结果恢复。由此仍有一串问题：刷新丢流、崩溃不知道跑到哪、上下文固定 24 条、长对话必丢前文、无法 fork/重放。
3. **第二关键差距是“执行”**：work 只有只读本地文件、HTTP 工具、时间工具；没有可写工作区、shell/终端、后台作业、子代理、文件系统技能。要成为“工作台”，这一层必须补，但必须和**审批 + 路径围栏 + 输出上限**一起补，不能先放能力后补安全。
4. **推荐路线**：语义对齐（Option A）。用 Postgres 事件表实现 DSH 的 append-only 会话与投影，用统一的 Agent Runtime 抽出聊天/定时任务共用的 turn/step、工具管线、预算与错误码；再把文件、shell、jobs、subagent、skills 逐项加上。DSH 的 Cordis 插件树、Typert RPC、内核级沙箱、多主体授权不进入 work。
5. **节奏**：P0 1–2 周（纠偏与护栏）→ P1 4 周（会话与上下文）→ P2 6–7 周（执行与编排）→ P3 4–5 周（API/UX/知识库）→ P4 持续（安全与运维）。单人约 70–90 人日、15–18 周；两人并行约 8–10 周。

### 里程碑总表

| 阶段 | 主题                                                    | 周期（单人） | 退出条件                                                                     |
| ---- | ------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| P0   | 纠偏、依赖护栏、运行时抽取、运行状态落库                | 1–2 周       | `typecheck`/`build`/`smoke` 在干净环境通过；聊天与定时任务共用同一套能力装配 |
| P1   | 事件源会话、投影、压缩、token、审批                     | 4 周         | 100+ 轮对话可压缩且工具调用成对；崩溃后能标出中断轮次；写操作可审批/拒绝     |
| P2   | 文件写入、shell、jobs、subagent、skills、web、todo/plan | 6–7 周       | 能在空间根内读写文件、跑命令、起后台作业、委派子任务，且全部有上限与审计     |
| P3   | 会话 API v2、时间线 UI、pgvector、调度加固、备份 v3     | 4–5 周       | 多标签页/刷新可续流；知识库检索走向量索引；定时任务有重试/死信/取消          |
| P4   | 安全、性能、测试、文档                                  | 持续         | 每季度安全 checklist、迁移演练、负载基线                                     |

### 0.1 本轮执行状态（2026-10-18）

| 项                      | 状态                      | 实际落地                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 文档纠偏           | 完成                      | [AGENTS.md](../../../AGENTS.md) 的 work 节改为 8 个工具、0006/0007 迁移、四入口导航、21 张表/导出 20 张、双 job CI；h3 段落改成“第三次回归已修复”。**迁移/表数随后由 P1-1 更新为 0008、22 张表/导出 21 张**                                                                                                                                                                                                                                                                                          |
| P0-2 依赖护栏           | 完成（路径调整）          | webapp/work 的 `h3` 精确 `1.15.11`；因 pnpm 12 不再读 `package.json.pnpm`，overrides 落在 [pnpm-workspace.yaml](../../../pnpm-workspace.yaml)；锁文件重生成；移除 work 未用的 `pg`/`@types/pg`/`@ai-sdk/deepseek`                                                                                                                                                                                                                                                                                    |
| P0-3 CI 校验            | 完成                      | [ci.yml](../../../.github/workflows/ci.yml) 新增 `verify` job：Work typecheck/test/build + Webapp typecheck，`install --frozen-lockfile`                                                                                                                                                                                                                                                                                                                                                             |
| P0-4 Agent Runtime      | **部分完成**              | 新增 [runtime.ts](../server/agent/runtime.ts) 的 `loadAgentCapabilities()`：绑定技能/工具/MCP、空间知识库过滤、工作台+本地+HTTP 工具、工具摘要、模型解析；chat 与 schedule-runner 已共用。完整 `runTurn()`/`agent/errors.ts` 与 SSE 适配留到 P1——两条链路的落库形状（parts/附件 vs `automation_runs`）不同，先把“能力装配”收敛，避免为抽象而抽象                                                                                                                                                     |
| P0-5 运行状态落库       | 完成（字段调整）          | 新增 `session_runs` + `0007_skinny_roughhouse.sql`；状态为 `running/completed/failed/aborted/interrupted`，`error_code` 可空；启动插件 await 清理遗留行；`/api/chat/runs` 合并内存与台账；export/import 已覆盖。**当前只有 `/api/chat` 写这张表**，定时任务仍以 `automation_runs` 为权威，不重复记一份                                                                                                                                                                                               |
| P0-6 请求 ID/错误码     | **部分完成**              | `00-request-id.ts` 分配/透传 `x-request-id`；`server/error.ts` 作为 `nitro.errorHandler` 同步补 `data.code`/`data.requestId` 与 `x-work-error-code`（`error` hook 是并行且不 await，实测来不及）；SSE 流内 `code`、前端 i18n 映射、全量结构化日志仍未做                                                                                                                                                                                                                                              |
| P1-1 事件日志与投影     | **完成（先旁路）**        | 新增 `session_events`（`0008_closed_ego.sql`）与 [events.ts](../server/agent/session/events.ts)、纯函数 [projection.ts](../server/agent/session/projection.ts)；`/api/chat` 在 user/assistant 消息落库后 best-effort 追加事件，失败不影响聊天。**`messages` 仍是唯一读路径**，事件只用于回填对账与后续切换。回填脚本 `scripts/backfill-session-events.ts` 按 `data.id` 幂等，已用临时会话验证 3 条事件投影与消息一致、重跑 0 新增。seq 改为「会话行锁 + max(seq)」，未加 `conversations.next_seq` 列 |
| P1-2 工具审计与运行边界 | **完成（chat + 定时任务）** | `/api/chat` 与 `schedule-runner` 均写 `user/message`、`run/start`、`request/header`、`tool/call`、`tool/result`、逐 step 检查点、最终 `assistant/message`、`run/end`（含 usage）；工具入参/输出裁剪到 20K 字符。启动时 `recoverInterruptedToolCalls()` 只为「有 run/start、无 run/end」的未配对调用写 `TOOL_OUTCOME_UNKNOWN` + `system/message`，不自动重跑。`deriveMessages()` 在有最终 assistant 消息时丢弃同轮检查点。**未做**：把 `messages` 彻底删掉/全量切事件读路径（刻意保留回退） |
| P1-3 Token 计量与压缩   | **完成（手动 + 自动）**  | [token-meter.ts](../server/agent/session/token-meter.ts) 提供 4 字符/token、每条 +4、128K×0.7；新增 [compaction.ts](../server/agent/session/compaction.ts)、`POST /api/conversations/{id}/compact`、`GET …/context`；压缩写 `compaction/start → system/message(compaction) → compaction/end(surface_op=replace)`，摘要排到保留消息之前，工具 call/result 不被拆开；`context.ts` 仅在存在压缩标记时切事件投影，否则继续读 `messages`；聊天历史卸载旧图、折叠旧工具输出。[chat.ts](../server/api/chat.ts) 在每轮取历史后按 `shouldAutoCompact()` 判断（窗口 > 70% 预算或顶到 24 条）自动压缩并重读上下文，`WORK_AUTO_COMPACT=0` 可关，压缩失败只跳过不影响聊天。**未做**：压缩后 usage 写回 `session_runs` 列、供应商真实 contextWindow 配置 |
| P1-4 审批与权限         | **完成（后端 + 聊天 UI）** | 新增 `approvals` 表（`0009_fancy_phalanx.sql`）与 `agents.approval_mode`（auto/ask/never）；[approval.ts](../server/agent/policy/approval.ts) 按工具名推导 read/write/network/execute，写 `approval/asked|decided`，超时/重启失败关闭；chat 与 schedule 都套 `wrapToolsWithApproval()`，后台任务 `noAnswerer` 立即拒绝；`GET /api/approvals`、`POST /api/approvals/{id}/decide`；ChatPane 轮询并渲染 [ApprovalCard.vue](../app/components/ApprovalCard.vue)（Enter 允许 / Esc 拒绝）。**未做**：MCP 工具的端到端审批实测、审批历史页 |
| P1-5 ToolRegistry / dispatch | **完成（轻量版）**     | [tool-registry.ts](../server/agent/tool-registry.ts) 在装配完成后统一包一层：60s 超时 + 外部 abort 合并、20KB 输出截断、`TOOL_TIMEOUT/TOOL_ABORTED/TOOL_FAILED` 稳定错误码、进程内指标 `/api/tools/metrics`；聊天与定时任务都在 MCP/子代理合并后调用，MCP 工具同样覆盖。未做：按工具声明 schema/risk 的注册表清单、工具级独立超时配置 |
| P1-6 UI 上下文与时间线   | **完成（时间线基础版 + 反向分页 + 消息内交付物卡）**  | 右侧检视栏新增上下文占用（tokens / 预算 / 百分比 / 来源 / 是否压缩）与「压缩旧历史」按钮，压缩后强制回源；新增「时间线」tab（[SessionTimeline.vue](../app/components/SessionTimeline.vue)），按 `seq` 统一渲染用户/助手消息、工具调用（配对结果后的状态、耗时、输出大小）、审批、压缩、run 起止与请求配置；没有 `run/end` 的轮次标「未收尾」，孤立工具结果保留；`local_edit_file` 显示变更前后。首屏只取最近 100 条，`GET …/events?before=<seq>` 反向分页，界面「加载更早事件」前插并保持滚动位置。主聊天区保留工具 chip/正文卡片；`present` 登记成功后 [ChatMessage.vue](../app/components/ChatMessage.vue) 在消息内直接渲染交付物下载卡（文件名/大小/MIME/下载链接），不必先打开右侧检视栏。**未做**：独立 diff 事件、浏览器视觉回归 |
| P2-1 可写文件工具        | **完成**                  | [local-files.ts](../server/utils/local-files.ts) 增加 `WORK_FILE_WRITE=1` 开关、`local_write_file/local_edit_file/local_mkdir`；父目录与目标都 `realpath` 后校验白名单，写入走同目录临时文件 + rename，支持 `expectedVersion`（sha256 前 16 位）冲突返回 `FS_STALE_VERSION`，单文件上限 200KB |
| P2-2 受控命令            | **完成**                  | 新增 [command-tools.ts](../server/utils/command-tools.ts) 的 `run_command`（`WORK_COMMAND_ENABLED=1` 才注入）：cwd 必须在 `WORK_FILE_ROOTS` 内、只透传基础环境变量、stdout/stderr 各保留头尾 50KB、超时后杀整棵进程树；risk=execute，auto 模式也要审批 |
| P2-3 后台作业            | **完成**                  | 新增 `jobs` / `job_chunks`（`0010_stormy_toro.sql`）与 [jobs.ts](../server/utils/jobs.ts)：`start_job` 立刻返回 jobId、输出按块落库、`job_output` 按 seq 增量读、`job_kill` 杀进程树；启动插件把遗留 running 标 `interrupted`；新增 `/api/jobs`、`/api/jobs/{id}`、`/api/jobs/{id}/kill` 与 [jobs.vue](../app/pages/jobs.vue)（3s 刷新、查看输出、终止） |
| P2-4 子代理              | **完成（只读）**          | 新增 [subagents.ts](../server/utils/subagents.ts) 的 `spawn_subagent`：同一智能体在独立会话里跑只读工具（工作台只读 + 本地只读），最多 8 步 / 120s，返回摘要与会话 id；刻意不把写文件、run_command、job 工具交给子级，避免绕过父级审批 |
| P2-5 文件系统技能        | **完成**                  | 新增 [skill-files.ts](../server/utils/skill-files.ts)：扫描 `WORK_SKILL_ROOTS` 下的 `SKILL.md`/`*.md`，解析 frontmatter 的 name/description，正文作 instructions，按路径哈希幂等 upsert（只增改不删）；设置页「技能 → 从目录同步」调 `POST /api/settings/skills/sync`。**按需披露已落地**：[skill-tools.ts](../server/utils/skill-tools.ts) 的 `skill_load(name)`，系统提示词只列 `/技能名 + 描述`，消息以 `/技能名` 开头时服务端直接把正文注入这一轮；绑定多个技能不再整份正文常驻上下文 |
| P2-6 联网工具            | **完成**                  | 新增 [web-tools.ts](../server/utils/web-tools.ts) 的 `web_fetch`（`WEB_TOOL_ENABLED=1`）：只允许 http/https、DNS 解析后拒绝回环/私网/链路本地、重定向逐跳复核、2MB/15s 上限、去脚本样式后截断；**`web_search` 已补**：`TAVILY_API_KEY` 或 `BRAVE_SEARCH_API_KEY`（`WEB_SEARCH_PROVIDER=tavily|brave` 显式指定），返回标题/URL/摘要，无 key 时不注入工具 |
| P2-7 待办、计划、目标    | **完成（轻量）**          | `todos` / `goals`（`0011_goofy_red_ghost.sql`）与 [session-assist.ts](../server/utils/session-assist.ts)、[assist-tools.ts](../server/utils/assist-tools.ts)：`todo_read/todo_write` 整表替换、`goal_get/create/update/continue`，revision 乐观锁冲突 409；`GET/PUT /api/conversations/{id}/todos`、`GET/POST/PATCH …/goal`、`POST …/goal/continue`；右侧栏新增「待办」tab（清单勾选、目标轮次、继续按钮）。计划模式为 `conversations.plan_mode` 开关（`0012_powerful_gunslinger.sql`）：系统提示只出计划，`exit_plan_mode` 写 `plan/proposed` 事件并退出；只做提示词约束、没有独立计划审批卡 |
| P2-8 会话检索工具        | **完成（已有能力）**      | 现有 `work_search` 已跨会话/知识库文档/排期检索，命令面板 `/api/search` 也覆盖会话、消息、自动化、空间、附件、知识库；本轮未改 |
| P3-1 会话 API v2         | **基本完成（读路径 + fork + requestId 幂等 + 唯一索引 + follow 续传）** | 新增 `GET/POST /api/sessions`、`GET /api/sessions/{id}/snapshot?asOfSeq=`、`GET …/events?after=&limit=`、`GET …/follow`（SSE 先 snapshot 后按 `id: seq` 推事件，支持 `Last-Event-ID`，30 分钟上限）、`POST …/fork`（按 asOfSeq 复制投影消息、事件与分叉点之前的 `session_runs`）。`prompt/stop/compact` 是 307 适配到旧端点；`prompt` 正文原样转发，`/api/chat` 接受显式 `requestId`，同会话同 id 的 running/completed 轮次返回 409 不重复调用模型（failed/aborted/interrupted 可重试）。`0017` 的 `session_runs_request_active_idx` 是部分唯一索引（仅非空 requestId + running/completed），真正并发的同 id 请求由数据库拦成 409；运行台账在装配工具前先占位。**未做**：follow 用 LISTEN/NOTIFY 而非 1.5s 轮询、浏览器端 `Chat.resume` 与 follow 的联动实测 |
| P3-2 交付物             | **完成（注册/下载/面板/时间线/diff/错误引导）** | 新增 `artifacts` 表（`0015`）与 [assist-tools.ts](../server/utils/assist-tools.ts) 的 `present`：路径经 `resolveAllowedPath` 白名单/realpath 校验、单文件 50MB，只登记元数据不复制；`GET /api/conversations/{id}/artifacts` 列表、`GET /api/artifacts/{id}/download` 下载（下载时重新校验白名单）；右侧「产物与预览」tab 显示会话交付物；「时间线」tab 统一展示工具/审批/压缩/运行事件，`local_edit_file` 显示 red/green 变更前后（2000 字符截断）；消息内附件 `file` part 已有图片内联与文件下载卡；聊天错误按稳定错误码/文案追加可操作提示（[chat-error.ts](../app/utils/chat-error.ts)）。**保留差异**：不新增独立 `file/diff` 事件（从 `tool/call` 入参提取） |
| P3-5 备份完整性和流式   | **部分完成（checksum + NDJSON 流式 + 单表游标分页 + NDJSON 导入）** | 导出顶层增加 `checksum`（[backup-checksum.ts](../server/utils/backup-checksum.ts) 按顶层键排序的 sha256）；导入若带 checksum 则校验，不匹配 400。新增 `GET /api/export/ndjson`：`meta → table/row/tableEnd → end` 逐行写出，边读边发，脱敏与 JSON 备份共用 [backup-builders.ts](../server/utils/backup-builders.ts)，`end.checksum` 是全部 row 行的 sha256。`?table=&after=&limit=` 支持单表按主键游标分页，`tableEnd` 回 `hasMore/nextAfter`，复合主键表拒绝单列游标；每页最多 2000 行、默认 500。`POST /api/import/ndjson` 接受整机 NDJSON，校验 checksum/表清单后重组为 JSON 形状，复用同一事务合并导入；存储设置页可直接选 `.ndjson` 文件。**未做**：ZIP、50MB 自动分片、事件分片、导出前 flush 活会话 |
| P3-3 知识库 pgvector     | **部分完成（1536 维双写 + HNSW + 混合加权 + 后台重建进度）** | `0016` 启用 `vector` 扩展、`kb_chunks.embedding_v vector(1536)` 与 HNSW cosine 索引；摄入时对 1536 维向量双写，旧行用 `pnpm --filter @repo/work embeddings:backfill` 回填；检索对 1536 维查询优先 `embedding_v <=> query`，`WORK_VECTOR_BACKEND=jsonb` 或维度不符/查询失败时回退原 JSONB 余弦；向量结果与 Bigram 关键词结果按 `fuseHybridHits()` 加权融合（关键词权重 0.8、同片段去重封顶 1），不再出现「有向量命中就把关键词库整批丢掉」；重建索引改为进程内后台任务，POST 立即回 202、GET 轮询 `processed/total` 进度，页面显示进度条且刷新/切页后可接回。**未做**：非 1536 维分表/分区、trgm 关键词通道（现为 Bigram）、P95 压测 |
| P3-6 搜索索引            | **完成（基础版）**        | `messages.content_text`（写入时由 [message-text.ts](../server/utils/message-text.ts) 维护，旧行用 `pnpm --filter @repo/work messages:backfill` 回填）+ `messages/conversations.title/kb_documents.title` 的 pg_trgm GIN 索引（`0013`，扩展 `pg_trgm`）；`/api/search` 的消息检索改查 `content_text`，`parts::text ILIKE` 回退仍保留在片段表达式里。没有生成列、没有向量混合检索；中文 2 字与 P95 未实测 |
| P3-4 调度加固            | **部分完成（乐观锁 + 软删除 + 取消）** | `schedules.revision` / `deleted_at`（`0014`）：PATCH 带 `revision` 且不匹配返回 409；成功写入 `revision+1`；DELETE 改为软删除并置 `enabled=false`，列表、详情、认领、手动运行都过滤 `deleted_at`。`POST /api/runs/{id}/cancel` 通过进程内 `AbortController` 中断正在执行的 `generateText`，运行详情页有「取消这一轮」；中断后 `lastError` 记为「用户已取消」。轮内重试只允许「还没执行过工具」的失败重试一次（固定 1.5s 退避），避免工具副作用重复。**未做**：每任务时区、可配置 `max_attempts`/指数退避/dead-letter、多进程 advisory lock（取消也只对本进程有效） |

**本轮验证**：

- `pnpm install`、`pnpm --filter @repo/work exec nuxt prepare`、`pnpm --filter @repo/webapp exec nuxt prepare`。
- `pnpm --filter @repo/work typecheck`、`pnpm --filter @repo/work build`、`pnpm --filter @repo/work test`（**243 项通过，0 失败**）、`pnpm --filter @repo/webapp typecheck`。
- `pnpm work:db:migrate` 成功；`drizzle.__drizzle_migrations` 现有 **15 条**，`session_runs` 8 列、`session_events` 8 列、`approvals` 11 列、`jobs` 12 列、`job_chunks` 7 列、`todos` 3 列、`goals` 9 列、`messages.content_text`、三个 pg_trgm GIN 索引、`schedules.revision/deleted_at`、`artifacts` 已核。`0006` 的两个列此前被手工加过但迁移表未记录，改成 `ADD COLUMN IF NOT EXISTS` 对账。
- 事件旁路：临时会话写入 3 条消息 → 回填 3 条事件（seq 1/2/3）→ 投影 id/role/parts 与 `messages` 一致；重跑回填新增 0 条，证明按 `data.id` 幂等。临时数据已删除。
- 并发：同一会话 10 个并发追加得到 seq 1–10 无重复、单调；不存在的会话走 best-effort 返回 `[]` 且只记日志，不抛给调用方。
- **端到端（本地 mock OpenAI，不访问外网）**：`POST /api/chat` 走真实 SSE 链路，第一轮模型返回 `work_today` 工具调用，第二轮返回正文。事件顺序为
  `user/message → run/start → request/header → tool/call → tool/result → assistant/message(checkpoint) ×2 → assistant/message(final) → run/end`；`run/end` 的 `usage` 为 2 steps / input 20 / output 8 / total 28，`messages` 与 assistant 事件都保留工具 part。`deriveMessages()` 只投影 user + 最终 assistant，两个检查点被正确丢弃。临时 provider/agent/会话已删除。
- **崩溃工具恢复（直接函数验证）**：临时会话写 `user/message + run/start + tool/call`（无 `run/end`），调用 `recoverInterruptedToolCalls()` 后得到 `tool/result`（`TOOL_OUTCOME_UNKNOWN`, `isError:true`, `recovered:true`）与一条 `system/message`；再次调用返回 0，证明幂等。临时会话已删除。
- 备份：`GET /api/export` 返回 26 个表键（含 `sessionEvents`、`approvals`、`jobs`、`jobChunks`、`todos`、`goals`，版本 5），再 `POST /api/import` 原样导入：其余全部 skipped、无错误；`approvals/jobs/jobChunks/todos/goals` 已进入导入顺序与日期列（`jobChunks.seq` 与 `messages.seq` 一样由序列重新生成）。
- **P2 执行能力（直接函数/冒烟）**：文件写入在临时白名单目录内新建/读回/版本冲突 409/`local_edit_file` 精确替换；`run_command` 在 cwd 内回传 stdout，超时 1s 杀进程并标 `timedOut`；`start_job` 完成后落库 `completed`、输出可按块读取，长作业可被 `job_kill` 标 `killed`；`web_fetch` 对 `127.0.0.1` 与 `file://` 分别返回 403/400。**未验证**真实模型调用子代理、`web_fetch` 对真实公网页面、Windows 之外的进程树清理。
- 真实 HTTP：`GET /api/health` 200 且带 `x-request-id`；`GET /api/definitely-not-found` 404，body 含 `data.code=not_found`、`data.requestId`，响应头 `x-work-error-code=not_found`。
- Token 计量：冒烟断言 4 字符/token、空串 0、每条消息 +4 token、128K × 0.7 = 89600 预算；`/api/chat` 的 `request/header.estimatedContextTokens` 与 `contextSource` 已接线。
- **压缩端到端（本地 mock）**：8 条消息（每条 ~800 字符）→ `compactConversation(budget=500)` 压缩前 6 条，写 `compaction/start → system/message → compaction/end(replace)`；投影为「摘要 + 最近 2 条」，`loadConversationContext()` 返回 `source='events'`，摘要位于最前；临时数据已删。
- **审批端到端（直接函数）**：`requestToolApproval(mode='ask', risk='execute')` 挂起 → `decideApproval(allow)` 唤醒；DB 行 `pending → allowed`，事件仅 `approval/asked → approval/decided` 两条（修复了决定与执行各写一次 decided 的重复）；临时数据已删。
- **P2-7（冒烟直连数据库）**：`todo_write` 整表替换并读回；目标创建 `revision=1/round=0`，错误 `expectedRevision` 返回 409，正确 revision 更新成功并递增，`continueGoal` 只推进 round 且恢复 active；临时会话与行已删除。计划模式未做真实模型链路，只验证了构建与类型。
- **P2-5/P2-6（冒烟纯函数）**：系统提示词只出现 `/smoke-skill` 与描述、不出现正文，停用技能不列出；`/smoke-skill` 能匹配并注入正文；`skill_load` 能取回正文、未知名称返回 `SKILL_NOT_FOUND`。无搜索 key 时 `hasWebSearch()=false` 且 `searchWeb` 返回 501，配置 key 后注入 `web_search`，`WEB_SEARCH_PROVIDER` 可切换供应商。**未验证**真实 Tavily/Brave 外呼与真实模型按需加载技能。
- **P3-1（真实 HTTP）**：生产构建启动在 `127.0.0.1:3010`，`POST /api/sessions` 建会话 → `GET snapshot`（空会话 `source=messages`、`asOfSeq=0`）→ `POST /api/chat` 写入一条真实消息（本机供应商成功返回 9 条事件：`user/message, run/start, request/header, tool/call, tool/result, assistant/message ×3, run/end`）→ `snapshot` 返回 2 条消息、`asOfSeq=9` → `events` 返回 9 条 → `fork` 复制 2 条消息并生成新会话 → 原会话与分叉都可读。两个临时会话已删除，搜索回落到 0 条。
- **P3-6（真实 HTTP）**：`GET /api/search?q=检索索引` 命中刚写入的消息（未回退到 `parts::text`），删除会话后不再命中；证明写入侧维护的 `content_text` 与查询侧列一致。`0013` 已应用，`pg_trgm` 与三个 GIN 索引创建成功；回填命令可重复执行（本机 0 条历史消息）。冒烟断言 `partsToPlainText` 只拼 text part。没有做 `EXPLAIN` 索引用例与 P95。
- **P3-2（真实 HTTP + 工具直调）**：临时目录内放 `report.md`，直接调用 `buildAssistTools(cid).present.execute()` 返回 artifact id、16 字节、`mimeType`；`GET /api/conversations/{cid}/artifacts` 列出该条；`GET /api/artifacts/{id}/download` 返回 200、16 字节正文与 `filename*=UTF-8''冒烟交付物`。随后删除会话（cascade 删除 artifact）并清理临时目录。工具的 50MB/非文件/越界分支只走代码审查，未逐条实测。
- **P3-5（纯函数）**：`backupChecksum` 对同样的两张表换顶层键顺序得到相同摘要，改一个值摘要变化且为 64 位 hex；导入端不匹配 400 的分支只走代码审查。
- **P4 密钥加密（纯函数 + 真实 HTTP）**：临时设置 `WORK_SECRET_KEY` 后 `sealSecret` 产出 `enc:v1:` 密文且不等于明文，`openSecret` 还原；明文/空串原样透传；篡改密文末尾会让 GCM 校验失败抛错。另用生产构建在 3010 启动，`POST /api/settings/providers` 建 `secret-smoke`，列表返回 `sk-s****moke`，库内 `api_key` 为 `enc:v1:` 67 字符；用同一掩码 PATCH 后库内密文逐字不变（不会把掩码写成新 Key）；再 PATCH 新 Key 后返回 `sk-s****-key` 且库内仍为密文。随后删除该供应商并停服。旧明文迁移、`WORK_SECRET_KEY_OLD` 换钥与存储密钥只走代码审查，未实测。
- **P1-5 注册表（纯函数 + HTTP）**：`applyToolRegistry` 对超 30KB 输出返回 `truncated`、正常输出原样；20ms 超时的慢工具得到 `TOOL_TIMEOUT`，指标累计 calls/truncated/timeouts。生产构建 `GET /api/tools/metrics` 返回 `{timeoutMs:60000,maxOutputBytes:20480,tools:{}}`。真实模型是否触发工具超时未测。
- **P3-1 分叉运行台账（真实 HTTP）**：临时插入 2 条事件 + 1 条 90 秒前的 `session_runs`，`POST /api/sessions/{id}/fork` 返回 `runCount:1`，新会话的 `session_runs` 与源运行一致；随后删除源会话与分叉。仍在跑的源运行会复制成 `interrupted`，该分支只走代码审查。
- **P3-1 requestId 幂等（真实 HTTP）**：在临时会话里预置一条 `completed` 运行（requestId=`idem-smoke-123`），`POST /api/chat` 带同一 `requestId` 返回 409「同一 requestId 已完成，未重复调用模型」，`data.duplicate=true`、`runId`/`status` 可读；该轮没有写入任何消息（`messages` 计数 0）。`requestId='bad id'` 返回 400。测试会话已删除。**两个真正并发的同 id 请求未测**，因为预检与 `startSessionRun` 之间没有唯一索引。
- **P1-3 自动压缩（纯函数）**：`shouldAutoCompact(70_001, 4, 24, 100_000)` 为真、恰好 70_000 为假；消息数达到 24 时为真。聊天里的「压缩 → 重读上下文」需要真实模型，未实测；`WORK_AUTO_COMPACT=0` 关闭分支只走代码审查。
- **P1-6 时间线（构建 + 打包核对）**：`SessionTimeline.vue` 与检视栏第四个 tab 通过 `typecheck`、`test`（232）、`build`；产物客户端 chunk 中能查到「会话时间线」文案。检视栏默认关闭且只在客户端展开，没有做浏览器点击的视觉回归；时间线接口 `/api/sessions/{id}/events` 之前已用真实 HTTP 验证过。**反向分页**由冒烟测试真实 DB 断言：同一会话追加 5 条事件后，`readSessionEventsBefore(id, 999, 2)` 返回 `[4,5]` 且 `hasMore=true`，`before=3&limit=1` 精确返回 `[2]`、不再包含 seq 3，并正确报告 seq 1 仍更早。
- **P1-6 时间线分页（构建）**：`GET …/events?before=` 改为 `desc + limit+1` 取最近一页再升序返回，`hasMore` 用多取的一条判定；首屏不再循环拉满 1000 条，而是最近 100 条 + 按需「加载更早」，前插后按滚动高度差补偿 `scrollTop`。`SessionTimeline.vue`、两个 locale 与 `events.get.ts` 通过 `typecheck` / `test` / `build`；未做真实浏览器滚动位置目测。
- **P1-6 消息内交付物卡（类型检查 + 构建）**：`present` 工具返回 `{id,title,path,size,mimeType}`，`ChatMessage.vue` 从 `tool-present` part 的 output 提取并渲染下载卡（按 id 去重、显示大小、链接到 `/api/artifacts/{id}/download`），不依赖右侧检视栏已加载；两个 locale 增加 `artifactUntitled`，`typecheck`、`test`（243）与 `build` 通过。**没有浏览器点击验证**下载卡在真实流式消息中的位置与样式。
- **P3-1 唯一索引（真实 DB）**：`0017` 已应用到本机 work 库；冒烟测试从 `pg_indexes` 断言 `session_runs_request_active_idx` 是 UNIQUE，并临时建 agent/conversation 后用同一 `conversationId + requestId` 连续 `startSessionRun` 两次：第一次成功，第二次被拦成 `statusCode=409`、`data.duplicate=true`，随后清理临时行。**真正并发**已补：6 个 `startSessionRun` 同时插入同一 `(conversationId, requestId)`，结果是恰好 1 个 fulfilled、5 个 409 `duplicate`（`test` 243 项通过）。真实 HTTP 层双请求仍未做（需要可控的慢供应商）。
- **P3-1 follow 续传（真实 HTTP + 真实 DB）**：临时 UUID 会话插入 3 条事件后，无 `Last-Event-ID` 时依次收到 `id: 1/2/3`；带 `Last-Event-ID: 1` 时先收到 `snapshot` 再只收到 `id: 2/3`（不重放已确认的 1）；带 `Last-Event-ID: 3` 时无事件、只收到 `: ping`。临时会话与事件已删除。这验证的是服务端按 seq 续传，**浏览器端断线后 `Chat.resume` 与 follow 的联动仍未实测**。
- **P4 MCP headers 加密（纯函数）**：配置 `WORK_SECRET_KEY` 后 `sealHeaders({Authorization:'Bearer mcp-smoke'})` 产出 `enc:v1:` 且 `openHeaders` 还原；空值与旧明文原样透传；`maskHeaders` 只返回 `****`、不含 `Bearer`；`mergeHeaders` 对回传的 `****` 保留原密文，解密后仍是原值。
- **P3-3 混合融合（纯函数）**：`fuseHybridHits` 让关键词 0.9 的命中（0.72）压过向量 0.5 的命中；同一片段两路都命中时合并成一条、分数封顶 1；只有一路时保持该路分数与顺序。真实 pgvector + 关键词的联合检索没有做数据库级压测（本机测试库当时无 KB 分块）。
- **P3-2 错误提示（纯函数）**：`chatErrorHintKey({ data: { code: 'TOOL_TIMEOUT' } })` → 超时提示；`Error('文件已被修改，请重新读取')` → 版本冲突提示；429/「请求过于频繁」→ 限流提示；未知文案返回 `null`，不硬套提示。UI 用 `build` 核对，未做浏览器级点击。
- **P3-2 diff 提取（纯函数）**：`extractFileDiff('local_edit_file', { oldText, newText })` 返回原文/新文且不截断；只读工具返回 `null`；2100 字符的 `oldText` 截到 2000 字符 + 省略号并标记 `truncated`。时间线 red/green 卡片只用构建与 bundle 核对，未做浏览器视觉回归。
- **P3-5 NDJSON 流式导出（真实 HTTP）**：生产构建启动后 `GET /api/export/ndjson` 返回 200、`content-type: application/x-ndjson; charset=utf-8`；本机小库 76 行 / 9950 字节，首行 `meta`（`work.backup.ndjson` v1）、末行 `end`，中间 27 张表的 `table`/`row`/`tableEnd` 齐全；用 Node 重新对全部 `row` 行算 sha256，与 `end.checksum` 一致（20 行）。同一份表清单由 JSON 与 NDJSON 共用，冒烟测试断言 NDJSON 端点确实引用 `backupBuilders` 且使用 `sendStream`。
- **P3-5 单表分页（真实 HTTP + 真实 DB）**：`GET /api/export/ndjson?table=agents&limit=1` 的 `tableEnd` 回 `hasMore=true` 与 `nextAfter=["<uuid>"]`；拿该游标请求第二页得到下一条 agent，且与第一页 id 不重叠。冒烟测试用真实表断言同样行为，并断言复合主键表（`sessionEvents`）传单列游标会被拒绝，不会静默跳行；真实 HTTP 对这一形状返回 400 `validation_failed`（`游标列数不匹配：sessionEvents 需要 2 列`）。
- **P3-5 NDJSON 往返导入（真实 HTTP + 真实 DB）**：`GET /api/export/ndjson` 得到 8525 字节整机导出；原样 `POST /api/import/ndjson` 返回 `tables=27`、`rows=20`、`inserted=0`、`skipped=20`，三条 warning 与 JSON 导入一致（密钥/向量/附件二进制）。同主键全部跳过，证明解析、表清单、行数、checksum 与单事务复用一致；冒烟测试另外断言截断（缺 `end`）、checksum 不符、单表分片三种输入都返回 400。
- **P3-3 后台重建（真实 HTTP + 真实 DB）**：新建空知识库后 `POST /api/settings/knowledge-bases/{id}/reindex` 返回 **202** 且 `started=true`、快照 `status=running`；约 0.8s 后 `GET` 同路径得到 `status=completed`、`total=0/processed=0/ok=true`，`provider` 为当前默认供应商；随后删除该临时知识库。空库不触发任何嵌入外呼，验证的是占位/后台执行/快照三条链路。冒烟测试另外断言：不存在的知识库返回 404 且任务快照保留为 `failed`、无任务的知识库返回 `null`。
- **P4 限流指标（真实 HTTP）**：`GET /api/metrics/rate-limit` 初始 `calls=0`；发一次 `GET /api/export/ndjson?table=agents&limit=1` 后再查，得到 `calls=1`、`allowed=1`、`memoryFallback=1`，`families` 里是 `export` 一族而不是完整 key。冒烟测试断言 key 前缀聚合、通过/拦截各记一次。
- **P4 历史明文批量加密（真实 DB + dry-run）**：用临时 64 位 hex 主密钥执行 `pnpm --filter @repo/work secrets:encrypt -- --dry-run`，真实扫描到 1 条明文供应商 Key、0 条存储/MCP/工具凭据，`dryRun=true` 且未写库；脚本路径、CLI 参数与包脚本已通过 `typecheck`。**未做真实写入**：测试库里的明文行属于现有供应商，用测试钥加密会让应用在无钥匙时读不出来；写路径的自校验与逐表 UPDATE 由代码审查覆盖。
- **P4 负载基线（真实 HTTP，开发构建）**：`pnpm --filter @repo/work bench -- --n=15` 在本机小库跑 15 次串行采样，得到 `projection 1000 events` p50/p95 = 0.1/0.5ms、`GET /api/sessions?limit=20` = 15.5/19.4ms、`GET /api/overview` = 15.9/35.5ms、`GET /api/search?q=smoke` = 15.4/22.3ms。数据量远低于 1 万会话/1 万 chunk 的目标场景，数字只用于同机改动前后对比；SSE 首事件因当时库内没有会话未采样。
- **P4 迁移演练（真实 DB：备份 → 空库 → 迁移 → 导入）**：新建 `work_migration_drill` 空库，`drizzle-kit migrate` 应用 **18 条迁移**，得到 **28 张业务表**；把当前库 `GET /api/export` 的 JSON 原样导入，返回 `inserted=19`、三条 warning（密钥/向量/附件二进制），计数为 `agents=3、skills=3、schedules=1、providers=1、spaces=2`。`spaces=2` 与 `inserted=19`（而非导出 20 行）是因为 `importWorkBackup()` 先 `ensureDefaultSpace()`，默认空间已存在、同主键跳过。演练库随后 `DROP DATABASE ... WITH (FORCE)`，当前库未改动。
- **P3-4（真实 HTTP）**：对种子排期发 `PATCH revision=999` 得到 409，带当前 `revision=0` 成功并把 revision 推到 1；`DELETE` 后 `GET` 返回 404、列表数量从 1 变 0。测试用的示例排期已被软删除（`deleted_at` 有值，行与运行记录仍在）。
- **P3-4 取消（构建 + 纯函数）**：`POST /api/runs/{id}/cancel`、`activeScheduleRuns` 与运行详情页按钮通过 `typecheck` / `test`（233）/ `build`；冒烟测试断言未知 run id 的 `cancelScheduleRun()` 返回 `false` 且不被当作活跃运行。**真实中断**未验证：本机没有模型供应商，起一条真实运行需要外部 API；`AbortSignal.any` 的合并语义由 Node 24 原生提供，未另写假模型桩。
- **未验证/未做**：真实供应商模型调用（只用本地 mock 验证了协议与链路）；MCP 工具的端到端审批与真实 MCP 建连；P3-3 的 P95 压测、P4 的认证与真实规模负载；P3-1 的浏览器端 follow/Chat.resume 联动与 HTTP 层并发竞态；P3-5 的自动分片/ZIP；时间线/diff/错误提示与消息内交付物卡没有浏览器级视觉回归；CI 尚未在 GitHub runner 跑过。

---

## 1. 现状解读

### 1.1 定位与硬边界

`packages/work` 是**单主、本机、无账号**的 AI 工作台，独立 Nuxt 应用 + 独立数据库。它的边界不是“登录”，而是：

- 只监听 `127.0.0.1`（[nuxt.config.ts](../nuxt.config.ts) 的 devServer；生产由 `NITRO_HOST` 控制，[env-guard.ts](../server/utils/env-guard.ts) 在非回环绑定时要求显式 `WORK_ALLOW_PUBLIC_BIND=true`）。
- 写请求做 Origin 核验（[local-origin.ts](../server/utils/local-origin.ts)）：外站 Origin 的 `POST/PUT/PATCH/DELETE` 一律 403；无 Origin 的请求（SSR、curl、定时任务）按本机放行。
- 所有 API 没有身份认证；**能连到本机端口的人等价于“就是你”**。这决定了后续所有权限设计都只能是“本机用户显式授权”，不能假装有租户隔离。

这个边界必须保留。任何“顺手加个反代/开放局域网”的方案，都必须先补认证（见 P4），否则等于把可写数据库敞开。

### 1.2 运行时链路

当前一次聊天的主链路（[chat.ts](../server/api/chat.ts)）：

1. 校验请求体（512KB 上限）、消息 UUID、限流（30 次/分）。
2. 解析 `agentId` / `conversationId`，读智能体、绑定技能/工具/MCP/知识库。
3. 保存用户消息（`messages`），读取历史窗口 `MAX_CONTEXT_MESSAGES=24`。
4. RAG：对空间知识库 + 全局知识库做嵌入检索，拼进系统提示词。
5. 装配系统提示词（[system-prompt.ts](../server/utils/system-prompt.ts)）：人设、北京时间、空间指令、技能全文、工具清单、工作台规则、json-render 目录。
6. 合并工具：工作台 8 个（[workbench-tools.ts](../server/utils/workbench-tools.ts)）、只读本地文件（[local-tools.ts](../server/utils/local-tools.ts)）、HTTP/时间（[tools.ts](../server/utils/tools.ts)）、MCP（[mcp.ts](../server/utils/mcp.ts)）、按需的 self-config。
7. `streamText`：`stopWhen(stepCountIs(maxSteps))`，默认 6 步；工具 30s、首块/块间 60s 超时。
8. `onFinish` 把最后一条 assistant 消息整体写入 `messages`；用户中断也保存已产出部分。
9. 生成中的回放缓冲在 [chat-runs.ts](../server/utils/chat-runs.ts)：512KB/12 轮/结束 60s 宽限/5min 判陈旧，**进程重启即丢**。

定时任务链路（[schedule-runner.ts](../server/utils/schedule-runner.ts)）复用同一套提示词/工具/知识库装配，但走 `generateText`，无 SSE；每轮写 `automation_runs`，用 `FOR UPDATE SKIP LOCKED` 认领、先推进 `nextRunAt` 再执行、`lastRunAt` CAS 回写、每 tick 最多 3 条。这套调度语义是 work 自己长出来的，和 DSH 的“提醒”不是一回事。

### 1.3 数据模型

`server/db/schema.ts` 共 28 张表（`session_runs` 为 P0 新增，`session_events` 为 P1-1 新增，`approvals` 为 P1-4 新增，`jobs` / `job_chunks` 为 P2-3 新增，`todos` / `goals` 为 P2-7 新增，`artifacts` 为 P3-2 新增）：

| 域       | 表                                                            | 关键点                                                                                                                                  |
| -------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 模型     | `providers`                                                   | OpenAI 兼容；`api_key` 明文；默认槽位有 advisory lock                                                                                   |
| 工作空间 | `spaces`                                                      | `local_root`、`default_agent_id`、`instructions`、归档                                                                                  |
| 能力     | `skills`、`tools`、`mcp_servers` + 三张绑定表                 | 技能是“提示词行”，工具是 HTTP/时间，MCP 是 http/sse                                                                                     |
| 知识     | `knowledge_bases`、`kb_documents`、`kb_chunks`                | 向量存 `jsonb`，应用层余弦，单次扫描上限 5000 块                                                                                        |
| 会话     | `conversations`、`messages`、`session_runs`、`session_events` | `messages` 有全局 `bigserial seq`；`session_runs` 记跨进程生命周期；`session_events` 是 append-only 旁路，`(conversation_id, seq)` 主键 |
| 审批/作业 | `approvals`、`jobs`、`job_chunks`                              | 审批行挂起 execute；作业输出按 `seq` 分块，进程重启后 running 标 `interrupted`                                                          |
| 存储     | `storage_configs`、`attachments`                              | S3 协议；服务端中转上传；配额                                                                                                           |
| 系统     | `system_settings`                                             | 单行                                                                                                                                    |
| 自动化   | `schedules`、`automation_runs`                                | `next_run_at` 绝对时刻、北京日语义、运行历史                                                                                            |

没有归属列（无 `user_id`）、没有租户、没有软删除；这是刻意的（[schema.ts](../server/db/schema.ts) 注释与冒烟测试第 13 节都把“没有 user_id/订单/会员表”当不变量）。

### 1.4 功能地图

| 模块     | 现有能力                                                                                            | 入口                                                             |
| -------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 今日     | 到期任务、今日已跑、未来 7 天、最近运行/会话、空间与计数                                            | `/`、[overview.ts](../server/api/overview.ts)                    |
| 对话     | SSE、附件、思考过程、工具卡、json-render、停止、重连、Markdown 导出、保存到知识库、从一轮建定时任务 | `/chat`、[ChatPane.vue](../app/components/ChatPane.vue)          |
| 空间     | 空间 CRUD、归档、空间主页、空间指令/本地根、默认智能体                                              | `/spaces`、[spaces.ts](../server/utils/spaces.ts)                |
| 资料库   | 附件上传/预览、知识库、文档、重建索引                                                               | `/library`                                                       |
| 自动化   | 日/周/间隔/一次、启停、立即运行、编辑、运行历史                                                     | `/tasks`、`/runs`                                                |
| 运行中心 | 状态筛选、分页、详情                                                                                | `/runs`、[runs/index.vue](../app/pages/runs/index.vue)           |
| 设置     | 通用、智能体、供应商、存储、技能、工具、MCP、知识库                                                 | `/settings/*`、[work-settings.ts](../app/utils/work-settings.ts) |
| 搜索     | 会话/消息/自动化/空间/附件/知识库，`ILIKE`                                                          | `Ctrl/Cmd+K`、[search.ts](../server/api/search.ts)               |
| 备份     | 20/21 表导出（仅丢 `kb_chunks`）、密钥置空、合并导入                                                | 存储设置页、[export.get.ts](../server/api/export.get.ts)         |

### 1.5 已经做对的工程约束（整改时不要改坏）

1. **时间口径**：所有“每天 09:00”按北京日算，`resolveSchedulePlan()` + `computeNextRunAt()` 是唯一实现；容器 UTC 不会漂移（[work-schedule.ts](../server/utils/work-schedule.ts)）。
2. **调度不重入**：认领先推进 `nextRunAt`、`tickInFlight` 闸门、CAS 回写、每 tick 限 3 条，避免失败任务变成每分钟外呼。
3. **出站安全**：私有地址拒绝、DNS 重绑定复查、不跟随重定向、大小/超时封顶（[outbound.ts](../server/utils/outbound.ts)）。
4. **提示词注入防御**：HTTP 工具模板固定 origin、header 不允许模型改；MCP header 合并有规则（[tools.ts](../server/utils/tools.ts)、[mcp.ts](../server/utils/mcp.ts)）。
5. **备份脱敏**：供应商 key、存储 secret、MCP/tool header 置空；向量与附件二进制明确不备份。
6. **错误脱敏**：聊天错误不回显 SQL/供应商原文；`onFinish` 落库失败只记日志。
7. **进程兜底**：连接类异常忽略，其余未捕获异常退出交由守护重启（[error-guard.ts](../server/plugins/error-guard.ts)）。
8. **前端契约测试**：语言键集合、导航表、图标、路由、调度算术都有冒烟断言（[smoke-test.ts](../scripts/smoke-test.ts)）。

这些是 work 的“资产”，整改时不能为了对齐 DSH 而拆掉。

### 1.6 问题清单（按严重度）

| 级别         | 问题                                                                                                                    | 证据/影响                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P0（已修）   | `AGENTS.md` 的 work 节已漂移：说工作台工具 3 个，实际 8 个；说迁移到 0005，实际有 0006；导航/设置描述也与代码不完全一致 | 本轮已按源码改写，并补上 0007/21 表/双 job CI                               |
| P0（已修）   | `h3` 声明为 `^2.0.5`，与 AGENTS 要求的精确 `1.15.11` + overrides 不符（第三次回归）                                     | 两包已精确钉 1.15.11，overrides 落 `pnpm-workspace.yaml`，锁文件已重生成    |
| P0（部分修） | 聊天与定时任务各自装配提示词/工具/知识库，逻辑重复                                                                      | 已抽出 `loadAgentCapabilities()` 共用；完整 turn 适配仍在 P1                |
| P0（已修）   | 生成中的权威状态在内存                                                                                                  | 已加 `session_runs` 台账并与内存合并；启动时遗留 `running` 标 `interrupted` |
| P0           | 无 token/cost 计量、无上下文压力指标                                                                                    | 长对话只能固定截断 24 条；用户不知道何时会丢前文                            |
| P1           | 无事件日志/检查点/压缩/fork/重放                                                                                        | 不能审计、不能恢复、不能“从某一轮分叉”                                      |
| P1           | 无工具审批、无风险分级                                                                                                  | 写文件/跑命令/外呼一旦加上就没有闸门                                        |
| P1           | 工具超时只靠 `streamText.timeout`，无逐工具 deadline/输出上限                                                           | 单个慢工具拖垮整轮；大输出撑爆上下文                                        |
| P1           | `messages` 只存“一轮一条”，工具调用/结果没有独立记录                                                                    | 无法做工具时间线、无法配对、压缩边界难对齐                                  |
| P1           | 本地文件只读，技能只是提示词行                                                                                          | 不能“改代码/整理文件”，技能不能渐进披露                                     |
| P2           | 无 shell/终端/后台作业                                                                                                  | 长命令、构建、测试无法在会话内完成                                          |
| P2           | 无子代理/编排                                                                                                           | 大任务不能拆分，单上下文扛不住                                              |
| P2           | 搜索只有 `ILIKE`，中文子串无索引                                                                                        | 数据量大后全表扫；消息 `parts::text` 匹配有假阳性                           |
| P2           | 知识库向量存 JSONB、应用层暴力余弦、扫描上限 5000                                                                       | 文档多后检索变慢；无混合检索/引用排序                                       |
| P2           | 调度无 revision/CAS 冲突码、无重试退避/死信、无取消                                                                     | 并发编辑后到覆盖；失败只能等下一周期；跑着的不能停                          |
| P2           | 备份是单文件全内存 JSON                                                                                                 | 大库导出内存峰值；无校验和/分片/事件日志                                    |
| P3           | 无 artifacts/deliverables 概念                                                                                          | 生成的文件只能留在消息里，不能作为交付物                                    |
| P3           | 无计划模式/待办/目标                                                                                                    | 多步任务没有可审查的计划与进度                                              |
| P3           | CI 只构建 Docker，不跑 work 的 typecheck/build/smoke                                                                    | 回归只能靠本地自觉                                                          |
| P3           | 依赖有未使用项（`pg`、`@ai-sdk/deepseek` 等）与未使用 UI 依赖                                                           | 安装体积/攻击面；不是功能问题但应清理                                       |

---

## 2. DSH 功能模块解读

### 2.1 分层

DSH 是 Cordis 插件/ bundle / profile 体系。对本方案有意义的不是“插件树”，而是它把 Agent 运行时拆成了四层：

```
Client (Web / CLI / SDK)
  → API Gateway / Session Controller（端点声明激活策略、流式 follow）
    → Agent Runtime（Agent handle、turn/step、工具管线）
      → Session（append-only 事件日志 + 投影 + 持久化 + 压缩 + 查询）
        → Capabilities（tools / skills / MCP / subagents / workflow / jobs / schedule）
          → Policy（sandbox / approval / permission presets / fs observation）
```

关键点：**会话日志是唯一真相，其余都是投影**；**请求是日志的纯函数**；**工具调用必须成对**；**策略在 dispatch 层统一执行，而不是各工具自己拼**。

### 2.2 八条值得照抄的不变量

1. 会话日志 append-only、`seq` 连续；模型看到的内容一定已经记录（`@deepseek-ai/dsh-session/README.md`）。
2. surface 修改只有 `replace`；系统提示是 surface node 0，受保护；压缩只替换旧区间（`@deepseek-ai/dsh-session/README.md`）。
3. 一次请求 = `header.config + deriveMessages() + header.tools` 的纯函数；请求对象深冻结，监听器只能读（`@deepseek-ai/dsh-agent-loop/README.md`、`@deepseek-ai/dsh-llm/README.md`）。
4. 检查点：模型请求前、顶层工具体前、每步前 flush；flush 失败则该动作不执行（`@deepseek-ai/dsh-session-checkpoint-policy/README.md`）。
5. 工具 call/result 必须成对；压缩边界用 `toolPairingBalancedBefore/After` 对齐；未答调用补 `TOOL_OUTCOME_UNKNOWN` 而不是重试（`@deepseek-ai/dsh-compaction/README.md`）。
6. 审批只有 `ask|never`，结果只有 `allowed-once|rejected|cancelled|unavailable`；没有 answerer 就失败关闭（`@deepseek-ai/dsh-user-approval/README.md`）。
7. 沙箱无法执行就报 `SANDBOX_UNAVAILABLE`，绝不降级；文件写有先读后写与版本栅栏（`@deepseek-ai/dsh-sandbox/README.md`、`@deepseek-ai/dsh-fs-observation-policy/README.md`）。
8. 客户端不持有真相：回显是内存中的待确认提交，持久事件到达后原子替换（`@deepseek-ai/dsh-api-session-controller/README.md`）。

### 2.3 与 work 相关的能力模块

| 能力   | DSH 包                                                                                  | 核心语义                                                  | 对 work 的启示                                         |
| ------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| 会话   | `dsh-session`、`dsh-session-persistence`、`dsh-session-projection`、`dsh-session-query` | append-only、flush 屏障、投影 `asOfSeq`、fork             | 用 Postgres 实现同构事件表；不要继续“消息表即真相”     |
| 循环   | `dsh-agent-loop`                                                                        | turn/step、抽屉式请求、工具并行、失败 attempt、崩溃收尾   | 抽 `AgentRuntime`，让聊天与定时任务共用                |
| 上下文 | `dsh-token-meter`、`dsh-compaction`、`dsh-compaction-basic`、`dsh-output-retention`     | token 压力、阈值压缩、工具结果裁剪                        | 固定 24 条改为“预算 + 压缩”                            |
| 工具   | `dsh-tools`、`dsh-tool-*`                                                               | 注册表、schema 进提示词、dispatch 管线、统一超时/输出上限 | 建立 work 自己的 ToolRegistry，不要把超时散落在调用点  |
| 文件   | `dsh-tool-fs`、`dsh-tool-fs-search`、`dsh-fs-observation-policy`                        | 读写/edit/glob/grep、先读后写、版本栅栏                   | 在 `spaces.local_root` 内做可写工具                    |
| 命令   | `dsh-tool-bash`、`dsh-tool-terminal`、`dsh-jobs`                                        | 一次性/持久 shell、后台作业、输出 ring                    | 先做“受控一次性命令 + jobs”，不做交互终端              |
| 委派   | `dsh-tool-subagent`、`dsh-subagent`                                                     | 子会话、立即返回 id、深度/并发上限                        | 单层子代理即可，不做 agent team                        |
| 编排   | `dsh-tool-workflow`                                                                     | 模型写 JS，`agent/parallel/pipeline/phase/log`            | **不照搬**；进程内任意 JS 风险高，先做声明式扇出或不做 |
| 技能   | `dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill`                                   | `SKILL.md`、目录注入、按需加载、`/name`                   | 把“技能行”升级为“目录 + 正文按需”                      |
| MCP    | `dsh-mcp-client`、`dsh-mcp-resources`                                                   | 命名空间、重连、resources                                 | 先补 resources，再谈 prompts                           |
| 联网   | `dsh-tool-web`、`dsh-web-fetch-http`                                                    | 搜索/抓取、仅公网、同源重定向                             | work 已有 SSRF 基建，补搜索 provider 与抓取工具        |
| 计划   | `dsh-tool-todo`、`dsh-plan-mode`、`dsh-goal`                                            | 整表替换、`/plan`、目标 revision                          | 先 todo/plan，goal 后置                                |
| 调度   | `dsh-schedule`                                                                          | 持久提醒、绝对 `scheduledAt`、投递历史                    | work 是“跑智能体”，语义不同，只借工程约束              |
| 安全   | `dsh-sandbox`、`dsh-fs-sandbox`、`dsh-user-approval`、`dsh-permission-presets`          | 三模式、一次性审批、预设                                  | 只做“应用层路径围栏 + 一次性审批”，不做内核沙箱        |

### 2.4 与 work 的定位差异（决定“抄什么”）

| 维度   | DSH                              | work               | 结论                                   |
| ------ | -------------------------------- | ------------------ | -------------------------------------- |
| 使用者 | 开发者/多项目，可能有远程/多主体 | 单主本机           | 不引入多主体授权、remote access        |
| 会话   | 日志是产品核心，可导出/上传/查询 | 会话是聊天记录     | 需要补日志，但不必做完整 format 迁移链 |
| 调度   | 给会话投递提醒                   | 跑智能体并生成会话 | 保留 work 语义，借 CAS/重试/取消       |
| 执行   | 内核沙箱、PTC、终端              | 无                 | 只做受控文件/命令，明确“不是安全沙箱”  |
| 扩展   | Cordis 插件市场                  | 固定功能 + DB 配置 | 不引入插件运行时                       |

---

## 3. 能力对照矩阵

图例：● 已有且可用；◐ 部分/有替代；○ 缺失。

| 能力域       | work 现状               | DSH 对应                   | 差距                       |
| ------------ | ----------------------- | -------------------------- | -------------------------- |
| 会话持久化   | ● `messages`            | ● 事件日志 + 投影          | 无事件/seq/surface/检查点  |
| 流式重连     | ◐ 内存缓冲              | ● follow + journal         | 重启丢失、无 cursor        |
| 上下文窗口   | ◐ 固定 24 条            | ● token meter + compaction | 无预算/压缩/裁剪           |
| 工具调用记录 | ◐ 在 assistant parts 里 | ● `tool/result` 事件       | 无独立时间线/配对/审计     |
| 工具审批     | ○                       | ● ask/never + 审计         | 无                         |
| 文件读       | ● 只读根                | ● read/glob/grep           | 无写/edit                  |
| 文件写       | ○                       | ● 先读后写 + 版本          | 无                         |
| Shell/终端   | ○                       | ● bash/terminal            | 无                         |
| 后台作业     | ○                       | ● jobs + ring              | 无                         |
| 子代理       | ○                       | ● subagent                 | 无                         |
| 工作流       | ○                       | ● workflow                 | 无（建议后置）             |
| 技能         | ◐ DB 提示词行           | ● SKILL.md + 按需加载      | 无文件系统/渐进披露        |
| MCP          | ◐ tools only            | ● tools + resources        | 无 resources               |
| 联网         | ◐ HTTP 工具             | ● web_search/web_fetch     | 无搜索/抓取                |
| 计划/待办    | ○                       | ● todo/plan/goal           | 无                         |
| 调度         | ● 自动化                | ◐ 提醒                     | 语义不同；缺 CAS/重试/取消 |
| 认证         | ○（回环）               | ● token + cookie           | 本机可不做，公网前必须做   |
| 多标签同步   | ◐ 事件 + 轮询           | ● 投影/流                  | 无统一 session 流          |
| 搜索         | ◐ ILIKE                 | ● FTS/查询工具             | 无索引/工具                |
| 知识库       | ◐ JSONB 暴力余弦        | —（DSH 无 RAG）            | 需 pgvector/混合检索       |
| API          | ◐ 资源端点              | ● 类型化 controller        | 无统一 session API         |
| 可观测       | ◐ console               | ● 事件/审计                | 无 request id/指标         |

---

## 4. 差距分析与整改目标

### 4.1 差距清单

- **G1 会话真相**：`messages` 是“结果表”，不是“过程日志”。无法回答“这一轮第几步、调了哪个工具、参数是什么、结果多大、为什么停”。
- **G2 崩溃恢复**：生成中状态在内存；进程退出后只能看到最后落库的完整消息，无法知道是否有未完成的工具副作用。
- **G3 上下文治理**：固定 24 条 + 技能全文 + 工具清单 + RAG，长对话必然截断；没有 token 预算、压缩、工具结果裁剪、图片降级。
- **G4 工具策略**：超时、输出上限、重试、审批、风险分级散落在各工具/调用点；新增写工具时没有统一闸门。
- **G5 执行能力**：只读文件 + HTTP，不能完成“改代码、跑测试、生成文件、批量处理”。
- **G6 编排能力**：单会话单模型，长任务无法拆分/并行/恢复。
- **G7 技能模型**：DB 行 + 全文注入，技能一多就撑爆提示词；不能从项目目录发现技能。
- **G8 检索**：ILIKE + JSONB 余弦，规模上来后不可用；没有引用、混合排序、会话内搜索。
- **G9 调度工程化**：无 revision、无重试退避/死信、无取消、多进程无互斥。
- **G10 API/UX**：无统一 session 流、无审批 UI、无 token/上下文指示、无工具时间线、无 artifacts。
- **G11 安全叙事**：Origin 检查不是认证；密钥明文；写工具一旦加入，边界必须重新定义。
- **G12 工程保障**：CI 不验证 work；文档漂移；依赖护栏缺失。

### 4.2 整改目标（可验收）

1. 任意一轮对话都能从日志回答：谁在什么时间、用什么模型/提示词/工具、产生什么结果、消耗多少 token。
2. 进程崩溃后重启：未完成轮次被标记 `interrupted`，未完成工具调用有 `TOOL_OUTCOME_UNKNOWN`，不会静默重放副作用。
3. 100+ 轮、含大工具结果的会话可以继续对话；压缩后仍保留最近上下文与工具配对。
4. 所有写文件/执行命令/外呼写操作都经过统一策略：默认拒绝或询问，允许则留审计。
5. 能在空间根内完成“读 → 改 → 跑测试 → 产出文件”的闭环，且有路径围栏、输出上限、超时。
6. 定时任务可重试、可取消、可查看每次尝试；并发编辑不互相覆盖。
7. 刷新/多标签页能续流；不再依赖“内存缓冲是权威”。
8. 知识库检索走向量索引，返回引用；搜索有索引。
9. `typecheck`/`build`/`smoke` 在干净环境可重复通过。

### 4.3 明确不做（防止范围爆炸）

- 不引入 Cordis 插件树、Typert RPC、客户端插件 bundle、`dsh` profile/bundle。
- 不做内核级沙箱（bwrap/Landlock/Seatbelt/Windows ACL restricted token）。work 的围栏是**应用层 canonicalize + 白名单根 + 审批**，并在 UI/文档中明确“不是安全沙箱”。
- 不做多主体授权、remote access、agent team、持久终端、PTC/`run_code`。
- 不照搬 DSH 的“提醒”调度来替换 work 的“自动化”；两者可以并存，但不能混语义。
- 不在没有审批/上限的情况下开放任意 JS workflow。
- 不为了“对齐”把回环绑定改成公网监听。

---

## 5. 目标架构

### 5.1 分层

```
┌──────────────────────────────────────────────────────────────┐
│ Client: Nuxt pages / ChatPane / Timeline / Approval / Jobs   │
│  - optimistic submit, snapshot + SSE(cursor), no authority   │
└───────────────────────────┬──────────────────────────────────┘
                            │ /api/sessions/*, /api/approvals/*, /api/jobs/*
┌───────────────────────────▼──────────────────────────────────┐
│ API / Session Controller                                     │
│  - create/resume/prompt/stop/fork/compact                    │
│  - snapshot(asOfSeq) + follow(Last-Event-ID)                 │
│  - endpoint activation policy: list 只读索引，不打开冷会话    │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ Agent Runtime                                                │
│  - resolve agent/capabilities/model/budget                   │
│  - turn/step loop, tool dispatch, approval, retry, cancel    │
│  - writes events at checkpoints                              │
└───────────┬───────────────────────────────┬──────────────────┘
            │                               │
┌───────────▼─────────────┐     ┌───────────▼──────────────────┐
│ Session Store           │     │ Capability Registry          │
│  events + projection    │     │ tools/skills/MCP/web/fs/...  │
│  compaction + token     │     │ risk/timeout/output metadata │
└───────────┬─────────────┘     └───────────┬──────────────────┘
            │                               │
┌───────────▼───────────────────────────────▼──────────────────┐
│ Persistence: PostgreSQL (+ Redis 可选) + S3 + 本地工作区      │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 目录建议

```
packages/work/
  shared/                         # 前后端共享的纯类型/事件/错误码
    contract.ts
    events.ts
    errors.ts
  server/
    agent/
      runtime.ts                  # 入口：runTurn()
      context.ts                  # 历史窗口 + 预算
      prompt.ts                   # 由 system-prompt.ts 演进
      tools/
        registry.ts               # 注册、schema、策略、dispatch
        workbench.ts              # 现有 workbench-tools
        filesystem.ts             # 新增读写
        shell.ts                  # 新增受控命令
        web.ts                    # 新增搜索/抓取
        jobs.ts
        subagent.ts
        skill.ts
      policy/
        approval.ts
        path-guard.ts
        limits.ts
      session/
        store.ts                  # append/derive/fork/flush
        projection.ts
        compaction.ts
        token-meter.ts
      run/
        jobs.ts                   # 内存 ring + DB 元数据
  api/
    sessions/...                  # v2
    approvals/...
    jobs/...
    chat/...                      # 兼容层，转调 runtime
  utils/                          # 保留现有纯函数，逐步搬入 agent/
  app/
    components/chat/              # Timeline/ToolCall/Approval/ContextMeter
    components/jobs/
    composables/useSessionStream.ts
```

### 5.3 路线选择

| 方案          | 做法                                               | 优点                                            | 代价                                                                                               | 结论                          |
| ------------- | -------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------- |
| A 语义对齐    | 在 Nuxt/Postgres 上实现事件日志、runtime、工具策略 | 完全可控；复用现有 DB/工具/知识库；无外部运行时 | 工作量大；要自己保证不变量                                                                         | **推荐**                      |
| B DSH sidecar | work 只做 UI，agent 跑 `dsh --profile sdk`/ACP     | 直接得到成熟 runtime/session/tools              | 数据双份；打包 Node/DSH；SDK 非稳定公开 API；许可证未声明；无法复用 work 的 Postgres 工具/RAG 配置 | 仅做 1 周 spike，不进入主路线 |
| C 直接嵌 DSH  | 把 `dsh-base` 当库                                 | 理论上最省                                      | README 明确 `dsh-base` 不是可 import 的库；Cordis 生命周期与 Nuxt 冲突                             | 不采用                        |

**决策**：A。把 B 作为“如果 work 要变成 DSH 的皮肤”的备选，单独评估。

---

## 6. 分阶段整改

### P0（第 1–2 周）：先止血，再动结构

#### P0-1 文档纠偏

更新 [AGENTS.md](../../../AGENTS.md) 的 work 节：

- 工作台工具：`work_today / work_list_schedules / work_create_schedule / work_update_schedule / work_list_runs / work_search / work_save_knowledge / work_update_space_memory`，共 8 个（[workbench-tools.ts](../server/utils/workbench-tools.ts)）。
- 迁移：`0000`–`0008` 共 9 条；`0006_fixed_lockjaw.sql` 增加 `spaces.default_agent_id` / `local_root`，`0007_skinny_roughhouse.sql` 新增 `session_runs`，`0008_closed_ego.sql` 新增 `session_events`。
- 导航：`/`、`/spaces`、`/library`、`/tasks` 四项（[work-nav.ts](../app/utils/work-nav.ts)）；`/runs` 是运行中心，不在顶部导航。
- 设置：8 页（[work-settings.ts](../app/utils/work-settings.ts)）。
- 调度：补充“失败重试/手动运行复用 `runScheduleNow()`/MCP 在 finally 关闭”等现状。

验收：文档描述与代码逐项对得上；不再出现“3 个工具/6 条迁移”。

#### P0-2 依赖护栏

- 把 `packages/work/package.json` 与 `packages/webapp/package.json` 的 `h3` 改成精确 `"1.15.11"`（无 `^`）。overrides **不能再写根 `package.json` 的 `pnpm` 字段**：pnpm 12 会忽略它并在 install 时告警；实际落在 [pnpm-workspace.yaml](../../../pnpm-workspace.yaml)：

    ```yaml
    overrides:
        h3: 1.15.11
    ```

- 执行 `pnpm --filter @repo/work exec nuxt prepare` 重新生成 `.nuxt/tsconfig*.json`，否则 typecheck 仍可能读旧缓存。
- 清理未使用依赖：`pg`、`@types/pg`、`@ai-sdk/deepseek`（work 内无 import；`providers.ts` 用 `@ai-sdk/openai`）；确认 `@nuxt/ui`、`@tiptap/*` 是否真的被 work 使用，未用则移除（`@tiptap` 在 commons 有消费者，work 是否直接需要要单独确认）。
- 验收：`pnpm install --frozen-lockfile` 后 `pnpm --filter @repo/work typecheck` 与 `pnpm --filter @repo/work build` 通过；`rg '"h3": "\^' packages` 无结果。

#### P0-3 CI 增加 work 校验

当前 [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) 只构建 Docker。增加 `verify` job（可与镜像 job 并行）：

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm --filter @repo/work typecheck
- run: pnpm --filter @repo/work test
- run: pnpm --filter @repo/work build
- run: pnpm --filter @repo/webapp typecheck
```

注意：work 的 smoke-test 在数据库不可用时只警告跳过；CI 不配数据库时应至少跑纯函数部分，并在日志里明确“DB 段跳过”。

验收：PR 上能看到 work 的 typecheck/build/smoke 结果；失败阻断合并。

#### P0-4 抽取 Agent Runtime

新增 `server/agent/runtime.ts`，把聊天与定时任务的公共装配抽出来：

```ts
export interface RunInput {
    agentId: string;
    spaceId: string | null;
    conversationId?: string;
    prompt: string;
    trigger: 'chat' | 'schedule' | 'manual' | 'subagent';
    signal?: AbortSignal;
}

export interface RunResult {
    conversationId: string;
    assistantText: string;
    usage: Usage;
    finishReason: string;
    steps: number;
}

export async function runTurn(input: RunInput): Promise<RunResult>;
```

内部顺序固定为：

1. `resolveAgent()`：智能体、模型、温度、maxSteps、审批模式。
2. `loadCapabilities()`：技能、工具、MCP、知识库（按空间收窄）。
3. `buildPrompt()`：人设、时间、空间指令、技能、工具摘要、RAG、json-render。
4. `buildToolRegistry()`：内置 + 本地文件 + HTTP + MCP + self-config。
5. `resolveHistory()`：事件投影 → 模型消息（P1 前仍读 `messages`）。
6. `runModel()`：`streamText` 或 `generateText`，统一超时/重试/取消。
7. `persist()`：assistant 消息 + 运行状态。

改造点：

- [chat.ts](../server/api/chat.ts) 只保留 HTTP/SSE 适配：解析、限流、建 run、`tapChatRun`、响应头。
- [schedule-runner.ts](../server/utils/schedule-runner.ts) 改为调用 `runTurn({ trigger: 'schedule' })`，保留 `automation_runs` 与调度认领。
- 新增 `server/agent/errors.ts`：稳定错误码（`MODEL_UNAVAILABLE`、`TOOL_TIMEOUT`、`TOOL_DENIED`、`CONTEXT_OVERFLOW`、`APPROVAL_UNAVAILABLE`、`FS_DENIED`…），API 只回 `{ code, message, requestId }`，不解析文案。

验收：聊天与定时任务对同一智能体产出相同的系统提示词与工具清单（加一个快照测试）；删除重复装配代码后 smoke 通过。

#### P0-5 运行状态落库

新增 `session_runs`（先不要求事件日志）：

```sql
create table session_runs (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  trigger text not null,              -- chat | schedule | manual | subagent
  status text not null,               -- running | completed | failed | interrupted | aborted
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  request_id text not null default ''
);
create index session_runs_conversation_started_idx
  on session_runs(conversation_id, started_at);
```

- 启动时插入 `running`；`onFinish`/`onError`/`catch` 三条路径都收尾。
- 进程启动时把遗留 `running` 标为 `interrupted`（只改 `finished_at is null` 的行），并在会话里注入一条“上次运行被中断”的系统提示（P1 后改为事件）。
- `/api/chat/runs` 改为读该表 + 内存缓冲合并：内存有则返回“可续流”，没有但表里 `running` 则返回“不可续流”。

验收：强杀进程后重启，`/api/chat/runs` 不再显示幽灵 running；会话详情能看到“上次中断”。

#### P0-6 请求 ID 与结构化日志

- 中间件生成 `x-request-id`（UUID），写入 `event.context.requestId`。
- 用 `server/error.ts` 的 `nitro.errorHandler` 在序列化前补 `data.code` / `data.requestId`；**不要用 `error` hook**（Nitro 并行调用且不 await，实测 404 body 里没有 data）。
- `console.error` 统一带 `requestId/conversationId/agentId/tool`（本轮只做了 5xx 的 requestId 日志，完整字段待 P1）。
- SSE 错误事件带 `code` 与 `requestId`，前端 `extractApiError` 按 code 映射 i18n。

验收：任一次失败能在日志里按 requestId 串起来；前端不再显示“未知错误”。

---

### P1（第 3–6 周）：事件源会话、上下文治理、审批

#### P1-1 事件表与投影（已完成 2026-10-18）

首版落地的 SQL（[0008_closed_ego.sql](../server/db/migrations/0008_closed_ego.sql)）：

```sql
create table session_events (
  conversation_id text not null references conversations(id) on delete cascade,
  seq bigint not null,
  type text not null,
  turn_id text,
  step_id text,
  surface_op jsonb,                   -- {"op":"replace","fromSeq":n,"toSeq":m}
  data jsonb not null,
  created_at timestamp not null default now(),
  primary key (conversation_id, seq)
);
create index session_events_type_idx on session_events(type);
```

**与草案的两处刻意差异**（都是为了少改存量结构）：

- 不加 `conversations.next_seq` / `last_event_at`。`seq` 在事务里用 `select ... for update` 锁会话行，再 `coalesce(max(seq),0)+1` 分配；单会话串行、无空洞，回填脚本复用同一把锁。代价是每次追加多一次 `max` 查询，单主本机可接受。
- `created_at` 用 `timestamp`（无时区）而不是 `timestamptz`，与 work 现有表的 `timestamp` 口径一致，避免同一库里两种时间类型混用。

事件类型（首版只实现前两种，其余是 P1-2/P1-3 的占位）：

| 类型                           | data                                           | 状态 / 说明                                                                                           |
| ------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `user/message`                 | `{ id, parts }`                                | **已实现**；用户输入（含附件引用）                                                                    |
| `assistant/message`            | `{ id, parts, isAborted }`                     | **已实现**；一次 `onFinish` 的最终 assistant 消息，`usage`/`finishReason` 留到 P1-2 的 `onStepFinish` |
| `tool/call`                    | `{ toolCallId, toolName, input }`              | P1-2；工具调用意图，执行前写                                                                          |
| `tool/result`                  | `{ toolCallId, toolName, output, isError }`    | P1-2；与 call 配对                                                                                    |
| `system/message`               | `{ text, source }`                             | 投影已支持；运行时注入（时间、压缩摘要、计划）                                                        |
| `request/header`               | `{ model, provider, system, tools, maxSteps }` | log-only，投影跳过                                                                                    |
| `compaction/start`             | `{ targetFromSeq, targetToSeq }`               | P1-3；压缩锁                                                                                          |
| `compaction/summary`           | `{ summary, tokensBefore, tokensAfter }`       | P1-3；摘要                                                                                            |
| `compaction/end`               | `{ fromSeq, toSeq, summarySeq }`               | P1-3；投影应用 `replace` 遮蔽                                                                         |
| `approval/asked`               | `{ approvalId, toolName, risk }`               | log-only                                                                                              |
| `approval/decided`             | `{ approvalId, decision, reason }`             | log-only                                                                                              |
| `run/start` / `run/end`        | `{ runId, status }`                            | 运行边界                                                                                              |
| `goal/…` / `plan/…` / `todo/…` | 见 P2                                          | 后置                                                                                                  |

写入点（P1-1 先挂在 `/api/chat` 的落库事务之后）：

1. 用户消息插入 `messages` 成功、拿到消息 `id` 后，只为**本次新插入**的消息追加 `user/message`，`turnId` 同一轮共享；客户端重试不会重复写事件。
2. `onFinish` 保存 assistant 消息成功后追加 `assistant/message`；`onConflictDoNothing` 没插入行时跳过，避免重放重复。
3. 两处都走 `appendSessionEventsBestEffort`：事件写失败只记日志（`console.error`），**不让聊天 500**。P1-1 的定位是旁路，不是权威。

投影规则（[projection.ts](../server/agent/session/projection.ts)，纯函数、无数据库依赖）：

- `user/assistant/system` 的 message 事件按 `seq` 折叠进历史；`request/header`、`run/*`、`tool/*`、`compaction/*` 跳过。
- `parts` 非数组时回退到 `data.text`；`id` 缺失时回退 `${role}:${seq}`。
- `surface_op=replace` 的区间 `[fromSeq,toSeq]` 被遮蔽，原事件仍保留（审计/重放）。
- `deriveMessages()` 只负责“给定事件流，历史长什么样”；事务与行锁在 [events.ts](../server/agent/session/events.ts)。

回填脚本 `scripts/backfill-session-events.ts`（`pnpm --filter @repo/work events:backfill`）：

- 按 `conversations.id` 升序逐会话读取 `messages`（按 `seq`），按角色生成 `user/message` / `assistant/message`；
- **按 `data.id` 幂等**，而不是 `on conflict (conversation_id, seq)`：事件 seq 由数据库现分配，重跑时同一个 seq 可能对应不同消息；用消息 id 判断“这条已经回填过”才能安全续跑；
- 每 100 条一个事务，回填后立刻 `deriveMessages()` 对账 id/role/parts，不一致打印会话与消息 id 并置退出码 1。

验收（本机已执行）：

- 临时会话 3 条消息 → 回填 3 条事件（seq 1/2/3）→ 投影与 `messages` 的 id/role/parts 完全一致；
- 重跑回填新增 0 条，幂等成立；
- `export` 已包含 `sessionEvents`（P1-1 时是 22 张表里 21 张；当前 28 张表里 27 张，`kb_chunks` 仍排除），`import` 在 `conversations`/`sessionRuns` 之后导入事件，带 `createdAt` 日期转换；`artifacts` 随 `attachments` 之后导入；
- **未做**：读路径仍走 `messages`；事件与消息不在同一事务（刻意，先保证聊天可用）；最终 `assistant/message` 不带 usage（逐 step 检查点与 `run/end` 带）。

#### P1-2 Runtime 写事件与检查点（完成：chat + 定时任务）

已落地（`/api/chat`，2026-10-18）：

1. 用户消息落库后写 `user/message`；每轮开头写 `run/start`（`runId=turnId`，`trigger=chat`）。
2. 调模型前写 `request/header`：model/providerId/maxSteps/messageCount/estimatedContextTokens/toolNames/systemChars/temperature/maxOutputTokens；不重复存完整 system/tools 定义。
3. `onToolExecutionStart` 写 `tool/call`，`onToolExecutionEnd` 写 `tool/result`（含 `isError`/`durationMs`）；入参与输出裁剪到 20K 字符，工具错误只留 name/message，避免一条事件撑爆 jsonb。
4. `onStepEnd` 逐 step 写 `assistant/message` 检查点（`checkpoint:true`，带 step 正文、工具 part、finishReason 与该步 usage）；正常完成时 `deriveMessages()` 看到同轮最终 assistant 消息就丢弃检查点，崩溃轮次则保留半截回复。
5. `run/end` 在 `onFinish`/`onError`/流启动失败三处收尾，只写一次；带 `status`、`reason`、`durationMs` 与累计 `usage`（steps/input/output/total/cached/reasoning）。
6. `pairToolEvents()`/`unpairedToolCalls()` 是纯函数：按 `toolCallId` 配对 call/result，列出只有 call 没有 result 的调用，供崩溃恢复判断。
7. 启动恢复 `recoverInterruptedToolCalls()`：只处理「有 `run/start`、无 `run/end`」的轮次里的未配对调用，补 `tool/result` 的 `TOOL_OUTCOME_UNKNOWN` 与一条 `system/message`；**不自动重跑**，重复启动幂等（补过结果后不再追加）。

**验证**：本地 mock OpenAI（不访问外网）返回 `work_today` 工具调用，再返回正文；事件顺序为
`user/message → run/start → request/header → tool/call → tool/result → assistant/message → run/end`，`run/end.usage` 为 2 steps / 20 input / 8 output / 28 total。崩溃恢复另用临时会话验证：`user/message + run/start + tool/call`（无 `run/end`）→ 恢复得到 `TOOL_OUTCOME_UNKNOWN` 与 `system/message`，再次调用返回 0。

仍未做：

- 恢复事件的边界：只补审计事实，不会把 `session_runs.error_code` 写进事件；也还没有「恢复后提示分级」（只读/幂等操作可建议重试，写操作必须人工核验）。
- 定时任务链路（`schedule-runner.ts`）尚未写 `session_events`。
- `approval/*` 与 `compaction/*` 未实现。

完整目标（后续按此推进）：

1. 收到 prompt：`user/message`。
2. 调模型前：`request/header` + flush（事务提交即 flush）。
3. 每个工具执行前：写 `tool/call`；审批时先写 `approval/asked`；执行后写 `tool/result`，与 call 配对。AI SDK 的 `onStepEnd`（以及当前版本可用的 `prepareStep`）用于步间检查点。
4. 每步结束：写 `assistant/message`（含 usage），flush；不要等整轮结束才写一条。
5. 轮次结束：`run/end`。

“flush”在 Postgres 里就是事务提交；不要用 `setTimeout` 批量写。崩溃恢复时：

- `session_runs.status='running'` 且 `finished_at is null` → 标 `interrupted`；
- 扫描未配对的 `tool/call`（有 call 无 result）→ 写 `tool/result` 的 `TOOL_OUTCOME_UNKNOWN`，提示模型“只重试只读/幂等操作，否则先核验副作用”；
- 在会话里插入 `system/message` 说明中断，UI 显示标记。

验收：模拟 `process.exit(1)` 后重启，会话出现中断标记；未完成工具调用有 `TOOL_OUTCOME_UNKNOWN`；不会自动重跑写操作。

#### P1-3 Token 计量与压缩（主要完成：手动压缩 + 读路径切换）

已落地（2026-10-18）：

- [token-meter.ts](../server/agent/session/token-meter.ts)：`estimateTokens()`（4 字符/token）、`estimateMessageTokens()`（每条消息 +4 token 角色开销）、`measureSurface()`（默认 128K × 0.7 预算，返回 tokens/budget/pressure）。
- `/api/chat` 的 `request/header` 已写 `estimatedContextTokens`，用于观察历史窗口大小。
- 冒烟测试覆盖空串、纯文本、每条消息开销与预算计算。

未做：usage 持久化到独立表/`session_runs`、供应商 `contextWindow` 配置、图片卸载、工具结果按投影裁剪。**自动压缩已接入 `/api/chat`**：窗口估算超过 70% 预算或达到 24 条读取上限时先压缩再重读上下文；手动压缩与 `GET …/context` 的观测口径不变。

完整设计：

```ts
export interface Usage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
    reasoningTokens?: number;
}
export function estimateTokens(text: string): number; // 4 chars/token 近似
export function measureSurface(messages: ModelMessage[]): { tokens: number; pressure: number };
```

- 每次 `onStepFinish` 读 `usage` 累加，写 `session_events` 的 `assistant/message`；同时在 `session_runs` 存汇总，供 UI 显示。
- 上下文预算 = 模型 `contextWindow`（供应商配置，缺省 128K）× 0.7；系统提示 + 工具 schema + RAG 先扣，剩余给历史。
- 压缩触发：`estimateTokens(history) > budget * 0.7` 或手动 `/compact`。
- 压缩算法（首版）：
    1. 选旧区间：从最早的非 system 消息开始，保留最近 `retainRatio=0.3` 的 token；边界用工具配对对齐（call/result 不拆开）。
    2. 写 `compaction/start`（带区间）。
    3. 用同一供应商的便宜模型（或同模型低温）生成摘要：要求保留事实、决定、未完成事项、工具结果中的关键数据；禁止编造。
    4. 写 `compaction/summary`（`system/message`，`source:'compaction'`）。
    5. 写 `compaction/end` + `surface_op=replace`。
    6. 失败：写 `compaction/end` with `error`，不替换；不要留半截。
- 工具结果裁剪：单个 `tool/result` 超过 `maxChars`（默认 20K）时，保留 head/tail + 中间省略标记；原结果仍存事件（可审计），但投影用裁剪版。
- 图片：超过模型预算时替换为 `[图片已卸载：id]`，不重发旧图。

验收：构造 120 轮 + 每轮 30K 工具结果的会话，压缩后能继续请求；工具配对不破；压缩前后 token 压力下降 ≥ 40%；手动 `/compact` 可重复执行。

#### P1-4 审批与权限（完成：MVP）

新增表：

```sql
create table approvals (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  run_id text,
  tool_call_id text,
  tool_name text not null,
  risk text not null,                 -- read | write | network | execute
  payload jsonb not null,
  status text not null default 'pending', -- pending | allowed | rejected | cancelled | expired
  reason text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
```

策略：

- 工具元数据 `risk`：`read`（读文件/搜索/时间/GET）、`write`（写文件/知识库/配置）、`network`（外呼写/抓取）、`execute`（shell）。
- 智能体字段 `approvalMode`：`auto`（读/空间内写自动）、`ask`（写/执行询问）、`never`（全部拒绝，用于“只读助手”）。
- 默认：`ask`；读工具自动；空间根内写自动（单主本机，这是可接受的便利）；shell 永远 `ask`。
- `ask` 时：写 `approval/asked` → 发 SSE `approval-required` → 等待 `POST /api/approvals/{id}/decide`（超时 5 分钟）→ 写 `approval/decided` → 允许则执行一次，拒绝则返回 `TOOL_DENIED`。
- 无 answerer（页面关闭/断线）→ `unavailable` → 失败关闭，不执行。
- 审计只在事件里，模型看不到审批 UI，只看到最终结果（与 DSH 一致）。

UI：`ApprovalCard.vue` 显示工具名、参数摘要、风险、允许一次/拒绝；键盘 Enter/Esc；同一时间只允许一个 pending。

验收：写文件在 `ask` 下必须弹窗；拒绝后工具不执行且模型收到 `TOOL_DENIED`；页面关闭后超时拒绝；审计事件可查。

#### P1-5 ToolRegistry 与统一 dispatch

```ts
export interface ToolDef {
    name: string;
    description: string;
    schema: z.ZodType;
    risk: 'read' | 'write' | 'network' | 'execute';
    timeoutMs?: number;
    maxOutputBytes?: number;
    parallelSafe?: boolean;
    execute: (input, ctx) => Promise<ToolResult>;
}

export function defineTool(def: ToolDef): ToolDef;
export function buildRegistry(agent, space): ToolRegistry;
```

dispatch 固定顺序：

1. 解析/校验输入（zod）。
2. 权限：路径围栏、agent 绑定、空间归属。
3. 审批：按 risk + mode。
4. 执行：`AbortSignal.any([runSignal, AbortSignal.timeout(timeoutMs)])`。
5. 输出：截断到 `maxOutputBytes`，附 `truncated` 标记。
6. 记录：`tool/result` 事件 + 指标。
7. 错误：映射稳定 code；`TOOL_TIMEOUT`/`TOOL_DENIED`/`FS_DENIED`/`SANDBOX_UNAVAILABLE`。

验收：所有工具都经 registry；新增工具不写 dispatch 也能获得超时/截断/审计；单测覆盖每个错误码。

**实现状态（P1-5，完成轻量版）**：[tool-registry.ts](../server/agent/tool-registry.ts) 提供 `applyToolRegistry(toolSet)`，在 [runtime.ts](../server/agent/runtime.ts) 装配完内置/本地/命令/网页/绑定工具后包一层，聊天与定时任务在 MCP、子代理合并后再调用一次；已包过的工具用 `Symbol.for('work.tool-registry.wrapped')` 标记，不会重复计时或重复截断。每次执行把调用方 `abortSignal` 与 60s 超时合并，工具忽略 abort 而迟到返回时按超时/中止处理，不会把迟到结果当成功；JSON 序列化超过 20KB 时返回 `{truncated:true,preview}`；异常映射 `TOOL_TIMEOUT / TOOL_ABORTED / TOOL_FAILED`。`GET /api/tools/metrics` 返回每个工具的 calls/failures/timeouts/truncated/totalMs（进程内，重启清零）。输入校验仍由 AI SDK 的 `inputSchema` 完成，审批仍在外层 `wrapToolsWithApproval`。**未做**：把 timeout/maxOutput 做成每个工具的声明字段、持久化指标、把 tool/result 事件写进注册表（仍由聊天/定时任务各自的链路写）。

#### P1-6 UI：上下文与时间线（完成：时间线基础版）

- `ContextMeter.vue`：显示已用/预算、压缩次数、最近压缩时间；点击看明细。
- [SessionTimeline.vue](../app/components/SessionTimeline.vue)：按 `session_events.seq` 把用户/助手消息、工具调用、审批、压缩标记、run 起止与请求配置排成一条线；工具卡显示耗时/状态/输出大小（20KB 截断后的大小），没有 `run/end` 的轮次显示「未收尾」，孤立 `tool/result` 保留。
- 保留现有 `ChatMessage` 的 json-render/思考过程，不重写渲染器；时间线放在右侧检视栏第四个 tab，与上下文/产物/待办并列。

验收：工具调用在时间线中是带状态/耗时/输出大小的卡片；压缩有可见标记；token 压力可见。主聊天区仍保留原工具 chip。

---

### P2（第 7–12 周）：执行能力与编排

#### P2-1 可写文件工具

前提：`spaces.local_root` 已存在（0006），`WORK_FILE_ROOTS` 仍作为全局白名单；新增 `WORK_WRITE_ROOTS` 或空间字段 `allow_write`。

工具：

| 工具       | 行为           | 上限                                    |
| ---------- | -------------- | --------------------------------------- |
| `fs_read`  | 读文本，带行号 | 2000 行/2000 字符每行/64KB              |
| `fs_list`  | 列目录         | 200 条                                  |
| `fs_glob`  | glob           | 100 条                                  |
| `fs_grep`  | 正则搜索       | 250 命中/2000 字节每行/30s              |
| `fs_write` | 创建/覆盖      | 需先读或确认不存在；1MB                 |
| `fs_edit`  | 字符串替换     | 单次；需先读；失败回 `FS_STALE_VERSION` |

路径围栏（`server/agent/policy/path-guard.ts`）：

```ts
export function resolveInsideRoot(root: string, input: string): string {
    if (!path.isAbsolute(input)) throw fsError('FS_PATH_NOT_ABSOLUTE');
    const realRoot = fs.realpathSync.native(root);
    const real = fs.realpathSync.native(input); // 不存在时对父目录 realpath
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw fsError('FS_OUTSIDE_ROOT');
    return real;
}
```

- 拒绝符号链接逃逸；拒绝 `.git`、`node_modules`（可配置）；Windows 大小写不敏感比较。
- 先读后写：内存 + DB `fs_observations(conversation_id, path, mtime_ms, size, hash, read_at)`；写时校验 mtime/size/hash，不匹配回 `FS_STALE_VERSION`。
- 原子写：同目录临时文件 + `rename`；失败清理。
- 输出统一截断并提示“已截断，使用 offset 继续读”。

验收：路径穿越/符号链接/大小写/不存在父目录都有测试；并发两次写同一文件，第二次回 `FS_STALE_VERSION`。

#### P2-2 受控命令

默认关闭：`WORK_ENABLE_SHELL=false`。开启后：

- 工具 `run_command`：`command`、`cwd`（必须在空间根内）、`timeoutMs`（默认 120s，上限 600s）、`run_in_background`。
- Windows 用 `pwsh -NoProfile -NonInteractive -Command`；Unix 用 `bash -lc`（明确 shell）。
- 环境变量白名单（`PATH`、`HOME`、`TEMP` 等），不继承供应商 key；`cwd` 固定空间根。
- 输出：stdout/stderr 各 16KB，超出截断；退出码；超时杀进程树。
- 审批：每次 `ask`（除非智能体显式 `auto` 且用户确认风险）；审计记录命令、cwd、退出码、耗时。
- **明确声明**：这不是安全沙箱；能读环境、能访问网络、能写空间根之外（取决于 OS 权限）。UI 必须显示风险提示；默认关闭。

验收：超时能杀进程树；后台命令进 jobs；输出截断有标记；审批拒绝不执行；关闭开关时工具不出现。

#### P2-3 后台作业

表：

```sql
create table jobs (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  kind text not null,                 -- command | workflow | subagent
  label text not null,
  status text not null,               -- running | stopping | completed | killed | failed
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  exit_code integer,
  progress text not null default '',
  error text not null default ''
);
create table job_chunks (
  job_id text not null references jobs(id) on delete cascade,
  offset bigint not null,
  stream text not null,               -- stdout | stderr | log
  data text not null,
  primary key (job_id, offset)
);
```

- 内存 ring 256KB/作业，DB 只存元数据与最多 64KB 尾部日志（避免数据库膨胀）。
- 工具：`job_output`（消费式读）、`job_list`、`job_kill`。
- 完成通知：写 `system/message` 到会话；busy 时下一步注入，idle 时唤醒（work 已有 Chat 实例，直接 `sendMessage` 需谨慎，先做“未读提示”）。
- 进程重启：`running` → `interrupted`，输出保留尾部。

验收：`run_command` 后台跑 3 分钟，期间可继续聊天；`job_output` 增量读；kill 后状态 `killed`；重启后不显示 running。

#### P2-4 子代理

- 表：`conversations.parent_conversation_id`、`parent_tool_call_id`、`depth`、`root_conversation_id`。
- 工具 `subagent`：参数 `description`、`prompt`、`agentId?`；立即返回 `childId`；子会话继承空间/知识库/工具，但**不继承**父消息历史（可 `fork` 可选）。
- 上限：`maxDepth=1`、每父会话 `maxActive=3`、每子代理 `maxSteps` 与 token 预算；超出拒绝。
- 父级收到完成通知（摘要 + 子会话链接），不把子消息塞进父上下文。
- `list_agents`/`interrupt_agent` 可选；不做 `send_message` 双向（首版）。

验收：父会话发起子代理后继续工作；子代理完成有通知；深度 2 被拒绝；并发上限生效；子代理失败不拖垮父轮。

#### P2-5 文件系统技能

- 根：`WORK_SKILL_ROOTS`（分号分隔），每个技能一个目录，含 `SKILL.md`；frontmatter `name/description/whenToUse`。
- 启动/请求时扫描一层（不递归），mtime 缓存；`SKILL.md` 正文不注入。
- 提示词只放目录：`- name: description (≤200 字)`；模型调 `skill_load(name)` 才返回正文。
- 输入框 `/skill-name` 直接注入正文（显式手势）。
- 保留 DB `skills` 作为“内联技能”，统一成 `SkillSource = 'db' | 'fs'`；绑定表仍按 id 关联，fs 技能用稳定 id `fs:<name>`。

验收：放一个 `SKILL.md` 到根目录，目录出现在提示词、正文不在；`skill_load` 可取正文；删除文件后下一轮消失；与 DB 技能可共存。

**实现状态（P2-5，已落地）**：扫描是递归最多 4 层（不是一层），单文件 200KB、最多 200 个；`skill-files.ts` 以 `file-<sha1(path)前16位>` 作稳定 id，只 upsert 不删除——**删除文件后不会自动消失**，这是与验收条的已知差距。`system-prompt.ts` 只列 `/name：description`（描述截 160 字）；`skill_load` 在聊天与定时任务都注入；`/name` 前缀在聊天由 `lastUserText`、在定时任务由 `row.prompt` 匹配，命中后正文直接追加到本轮 system，不依赖模型调用工具。没有 `SkillSource` 列，DB 技能与 fs 技能共用 `skills` 表，靠 id 形态区分。

#### P2-6 联网工具

- `web_search`：provider 可配（DeepSeek 原生搜索 / Tavily / Brave），返回标题/URL/摘要；默认关闭，需配置 key。
- `web_fetch`：复用 [outbound.ts](../server/utils/outbound.ts) 的 SSRF/大小/超时；仅 http/https、仅公网、同源重定向、5MB/100K 字符/30s；返回 markdown 或文本。
- 审批：`web_fetch` 公开地址自动；`web_search` 自动；内网地址拒绝（除非 `ALLOW_PRIVATE_OUTBOUND`）。

验收：私网/回环被拒；重定向到私网被拒；大响应截断；搜索结果有来源 URL。

**实现状态（P2-6，已落地轻量版）**：`web_search` 支持 Tavily（`TAVILY_API_KEY`，POST `api.tavily.com/search`）与 Brave（`BRAVE_SEARCH_API_KEY`，GET `api.search.brave.com/res/v1/web/search`），`WEB_SEARCH_PROVIDER` 可显式指定；两者都是固定端点 + `assertPublicUrl` 复核，结果限 8 条、标题 300/URL 2000/摘要 1000 字，响应 >2MB 拒绝。没有接入 DeepSeek 原生搜索（没有稳定公开的搜索 API），未配置 key 时工具根本不注入。`web_fetch` 是 2MB/15s/5 万字符，不是本节早期写的 5MB/30s；重定向逐跳复核而不是仅同源。两者 risk=`network`，`auto` 模式直接放行、`ask` 模式要审批。

#### P2-7 待办、计划、目标

- `todos`：`conversation_id`、`items jsonb`、`updated_at`；工具 `todo_write` 整表替换；UI 侧栏面板。
- 计划模式：`/plan` 切换；系统提示加“只输出计划，等待批准”；工具 `exit_plan_mode(plan)` 写入 `plan` 事件并请求批准；批准后恢复普通模式。**只做提示词约束，不限制工具**（与 DSH 一致，明确告知）。
- 目标：`goals` 表（`conversation_id`、`objective`、`status`、`revision`、`round`、`max_rounds`）；工具 `get_goal/create_goal/update_goal`；不做自动续跑（避免无人值守烧 token），只做“继续”按钮。若后续要自动续跑，必须复用调度器并加预算/轮次上限。

验收：计划模式能产出计划并等待批准；批准后继续执行；todo 面板与事件同步；目标 revision 冲突返回 409。

**实现状态（P2-7，已落地轻量版）**：

- `todos`（`conversation_id` 主键、`items jsonb`、`updatedAt`）与 `goals`（`id`、唯一 `conversation_id`、`objective`、`status`、`revision`、`round`、`maxRounds`）在 `0011_goofy_red_ghost.sql`；`conversations.plan_mode` 在 `0012_powerful_gunslinger.sql`。`todos`/`goals` 已进 export/import（版本 5）。
- 工具：`todo_read/todo_write`、`goal_get/goal_create/goal_update/goal_continue`、`exit_plan_mode`；聊天与定时任务都注入，`todo_read/goal_get/exit_plan_mode` 归为 read 风险。
- API：`GET/PUT /api/conversations/{id}/todos`、`GET/POST/PATCH /api/conversations/{id}/goal`、`POST /api/conversations/{id}/goal/continue`、`PUT /api/conversations/{id}/plan-mode`。
- UI：右侧检视栏第三个「待办」tab，展示清单（可勾选完成）、计划模式开关、目标正文/轮次/状态与「继续一轮」按钮。
- 并发：`updateGoal` 的 `WHERE id AND revision = 读取值` 是真正的 CAS，显式 `expectedRevision` 与并发隐式冲突都返回 409；`createGoal` 用唯一约束 + `onConflictDoNothing` 同样返回 409。
- 诚实边界：计划模式只有系统提示词约束，没有工具级硬限制；`exit_plan_mode` 把计划写进 `plan/proposed` 事件并关闭开关，没有独立的计划审批卡，用户确认仍是下一条消息。没有 `plans` 表，计划正文只存在事件里。

#### P2-8 会话检索工具

- `session_search(query, filters)`：当前空间/全部；Postgres `pg_trgm` GIN 索引 + `ILIKE` 回退；返回会话标题、片段、时间、链接。
- `session_read(conversationId, fromSeq?, limit?)`：只读投影；跨会话需显式 id（本机单主，不做 cwd 授权）。
- 复用 `/api/search` 的实体范围，但改为索引查询。

验收：1 万条消息下搜索 < 200ms；中文子串可命中；结果带高亮片段。

---

### P3（第 13–17 周）：API、UI、知识库、调度、备份

#### P3-1 会话 API v2

| 方法   | 路径                                   | 说明                                 |
| ------ | -------------------------------------- | ------------------------------------ |
| `POST` | `/api/sessions`                        | 创建会话（agentId/spaceId/title）    |
| `GET`  | `/api/sessions`                        | 列表（只读索引列，不打开事件体）     |
| `GET`  | `/api/sessions/{id}/snapshot?asOfSeq=` | 投影快照                             |
| `GET`  | `/api/sessions/{id}/events?after=`     | 事件分页                             |
| `GET`  | `/api/sessions/{id}/follow`            | SSE，`id: seq`，支持 `Last-Event-ID` |
| `POST` | `/api/sessions/{id}/prompt`            | 发送消息（幂等 `requestId`）         |
| `POST` | `/api/sessions/{id}/stop`              | 取消当前 run                         |
| `POST` | `/api/sessions/{id}/compact`           | 手动压缩                             |
| `POST` | `/api/sessions/{id}/fork`              | 从 `asOfSeq` 分叉                    |
| `POST` | `/api/approvals/{id}/decide`           | 允许/拒绝                            |
| `GET`  | `/api/jobs` / `/api/jobs/{id}`         | 作业列表/输出                        |
| `POST` | `/api/jobs/{id}/kill`                  | 取消                                 |

- 旧 `/api/chat` 保留为适配器：内部调用 `runTurn()`，响应仍是 UI message stream；新客户端走 v2。
- SSE 断线：先发 `snapshot`（含 `asOfSeq`），再发 `seq > asOfSeq` 的事件；客户端按 `seq` 去重，发现空洞则重新拉 snapshot。
- `requestId` 幂等：同会话同 requestId 的 prompt 只接受一次，返回原 run。

验收：两个标签页同时打开同一会话，都能收到增量；断网重连不重复消息；刷新后从 snapshot 恢复；fork 后原会话不变。

**实现状态（P3-1，基本完成）**：`server/api/sessions/index.ts`、`[id]/snapshot.get.ts`、`[id]/events.get.ts`、`[id]/follow.get.ts`、`[id]/fork.post.ts` 已落地；`snapshot` 无 `asOfSeq` 时复用 `loadConversationContext`（仅压缩过的会话读事件投影），带 `asOfSeq` 时从事件投影截断。`fork` 复制投影消息到新会话、事件 `seq` 从 1 重建，并复制分叉点之前的 `session_runs`（仍在跑的源运行标记为 `interrupted`）。`prompt/stop/compact` 是 307 适配到 `/api/chat`、`/api/chat/{id}/stop`、`/api/conversations/{id}/compact`；`requestId` 在 `/api/chat` 正文中生效（v2 `prompt` 的 307 保留正文），同会话同 id 的 running/completed 轮次 409，failed/aborted/interrupted 可重试。**并发闸门**是 `0017` 的部分唯一索引 `session_runs_request_active_idx (conversation_id, request_id) WHERE request_id <> '' AND status IN ('running','completed')`：应用层预检仍保留（快速返回、给出已有 runId），但两个请求同时通过预检时只有一条能插入 running 台账，另一条由 [session-runs.ts](../server/utils/session-runs.ts) 把 SQLSTATE 23505 转成同样的 409 `duplicate`。运行台账在 `/api/chat` 装配 MCP/工具前就先占位，避免并发请求先把建连与审批都做完。失败/中止/中断不在索引条件里，所以同一 id 仍可重试；空 requestId 的旧客户端互不冲突。`follow` 先发 `snapshot`，再每 1.5s 查一次 `session_events`，空闲时发 `: ping`；不是 PostgreSQL LISTEN/NOTIFY，也没有服务端背压。并发请求在落 user 消息之后才撞上唯一索引，因此败者可能留下按消息 id 幂等的同一条 user 消息与一条 `run/end(failed)` 事件，但不会调用模型。

#### P3-2 时间线与交付物

- `ChatTimeline` 统一渲染：用户消息、assistant（含 reasoning）、tool call（参数/结果/耗时）、approval、compaction、run interrupt、job 通知、plan/goal 标记。
- `present` 工具：把生成的文件登记为 `artifacts`（路径、mime、大小、来源消息）；UI 右侧“交付物”面板；消息里显示文件卡。
- 文件 diff：`fs_edit`/`fs_write` 产生 `diff` 事件，UI 显示变更前后。
- 错误态：每种 code 对应可操作提示（重试/打开设置/缩小附件）。

验收：一次“读文件→改→跑测试→present”的流程在 UI 完整可见；点击交付物能打开/下载。

**实现状态（P3-2，完成）**：`artifacts`（id、conversation_id cascade、title、path、mime_type、size、created_at，`0015`）与 `present` 工具已落地；工具只接受 `WORK_FILE_ROOTS` 内的绝对路径，`realpath` 后校验，超过 50MB 拒绝。列表与下载接口不内联文件体，下载时重新 `resolveAllowedPath`，因此把目录移出白名单后旧记录自动 403。右侧面板只显示标题与大小，点击 `<a download>` 回读。**时间线**已由 `SessionTimeline.vue` 实现（消息/工具/审批/压缩/run，工具耗时与输出大小）；`local_edit_file` 用 [timeline.ts](../app/utils/timeline.ts) 的纯函数从 `tool/call` 入参提取 `oldText/newText`，时间线渲染 red/green 两块，超过 2000 字符截断并提示。消息内附件 `file` part 已有图片内联与文件下载卡（`ChatMessage.vue`）。**错误引导**由 [chat-error.ts](../app/utils/chat-error.ts) 提供：先从 `data.code` / `code` / `message` / `cause` 里收集文本，再映射到超时、中止、审批拒绝、`FS_STALE_VERSION`、限流、请求体过大、供应商失败、文件白名单、403 九类提示，附加在原始错误下方；识别不了就不硬套。**刻意不新增**独立 `file/diff` 事件：入参已完整，独立事件还要同时扩投影、恢复与导入三处。

#### P3-3 知识库 pgvector

- 启用 `CREATE EXTENSION IF NOT EXISTS vector;`（不可用时降级回 JSONB，UI 提示）。
- 新列 `kb_chunks.embedding vector(1536)`（维度按 KB 配置；不同维度分表或分区，首版限制单库单维度）。
- HNSW 索引：`CREATE INDEX ON kb_chunks USING hnsw (embedding vector_cosine_ops);`
- 双写：写入时同时写 `embedding` 与旧 `jsonb`；回填脚本 `scripts/backfill-embeddings.ts`；切换读路径 `WORK_VECTOR_BACKEND=pgvector|jsonb`。
- 混合检索：向量分 + `pg_trgm` 文本分加权；返回 chunk id、doc id、score、snippet；提示词带引用编号。
- 重建索引：后台 job，进度写 `kb_documents.status`；失败可重试。

验收：1 万 chunk 检索 P95 < 100ms；换模型维度时拒绝混用并提示重建；引用可点回文档。

**实现状态（P3-3，部分）**：本机 `pg_available_extensions` 含 `vector 0.8.6`；`0016` 成功创建扩展、影子列 `embedding_v vector(1536)` 与 `kb_chunks_embedding_v_hnsw_idx`。写入在 [kb-ingest.ts](../server/utils/kb-ingest.ts) 对 1536 维同时写 JSONB 与 `embedding_v`；历史行由 [backfill-embeddings.ts](../scripts/backfill-embeddings.ts) 幂等回填（只扫 `embedding_v is null` 且长度 1536，遇非 1536 维即停）。检索在 [embedding.ts](../server/utils/embedding.ts) 对 1536 维查询先走 `1 - (embedding_v <=> $1::vector)`，命中后不再加载该库的 JSONB 分块（分块预算只被回退路径消耗），SQL 失败只告警一次并回退 JSONB；`WORK_VECTOR_BACKEND=jsonb` 可强制旧路径。**混合加权**由 `fuseHybridHits()` 实现：分别收集向量命中与关键词命中，按 `vectorScore + 0.8 × keywordScore` 合并、封顶 1、同 `kbId+documentId+content` 去重后排序取 topK；没有向量命中时退化为纯关键词，有向量命中但某库没有嵌入供应商时该库的关键词结果也会保留。关键词通道仍是 Bigram 重叠率（`kb_chunks.content` 尚无 trgm 索引），不是 SQL `similarity`。**后台重建**在 [kb-reindex.ts](../server/utils/kb-reindex.ts)：`POST /api/settings/knowledge-bases/{kbId}/reindex` 先同步占位（并发第二次直接 409）再解析供应商、立即回 202；执行仍按 `(created_at,id)` keyset 逐页扫描、16 块一批嵌入，任务表更新 `processed/updated/failed/lastError`，`GET` 同路径返回快照，页面每秒轮询、显示进度条、完成后自动刷新统计；任务表进程内、重启丢失（数据不受影响，重新发起即可）。**没有做**非 1536 维的独立表/分区、trgm 关键词通道、P95 压测和引用回链。

#### P3-4 调度加固

- 加列：`revision int not null default 0`、`timezone text not null default 'Asia/Shanghai'`、`max_attempts int default 3`、`backoff_seconds int default 60`、`next_attempt_at timestamptz`、`deleted_at timestamptz`。
- 更新：`PATCH` 带 `revision`，不匹配回 `409 SCHEDULE_CONFLICT`；删除改软删除，运行记录保留 30 天。
- 失败：同一次 occurrence 失败后按指数退避重试（60s/5min/30min），超过 `max_attempts` 记 `dead_letter`（`automation_runs.status='failed'` + `error`），不自动禁用周期任务；下一次 occurrence 照常。
- 取消：`POST /api/schedules/{id}/runs/{runId}/cancel`，abort 当前 `generateText`；状态 `cancelled`。
- 多进程：`pg_try_advisory_lock(hashtext('work:schedules:tick'))` 包住 tick，避免多实例重复认领；单进程仍保留 `tickInFlight`。
- 时区：默认北京，允许每任务 IANA；表单用浏览器时区但显示明确。

验收：并发 PATCH 后到 409；失败任务按退避重试；取消 3 秒内生效；两进程同时 tick 只有一方执行。

**实现状态（P3-4，部分）**：`0014` 只加了 `revision` 与 `deleted_at`。PATCH 的 `revision` 是**可选**的：旧前端不发就不会冲突，只有显式带上才做 CAS；成功写入一律 `revision+1`，所以客户端拿到旧 revision 后仍会 409。DELETE 变成软删除，`automation_runs` 与历史会话都保留；列表/详情/`run-due`/手动运行四条路径都过滤 `deleted_at`。**取消**：`runScheduleNow` 与定时认领共用 `executeSchedule`，每轮在 `activeScheduleRuns` 里登记一个 `AbortController`，其 signal 与 5 分钟总预算经 `AbortSignal.any` 合并后传给 `generateText`；`POST /api/runs/{id}/cancel` 先查库确认 `status='running'`，再要求这个 run 确实在本进程的 Map 里（重启后遗留的 running 行不可取消，返回 409 说明会由启动自愈收口），成功取消后 `describeRunError` 被替换成「用户已取消」，`finally` 统一 `delete`。**轮内重试**仍是「最多 2 次、固定 1.5s」，但新增两条硬约束：退避等待结束后先检查是否已取消（不能醒来再打一次供应商），且**只要执行过工具就不再重试**——工具可能有发消息/写文件等外部副作用，重试等于让副作用发生两次。每任务时区、可配置 `max_attempts`/指数退避/dead-letter、多进程 advisory lock 仍未做；取消只对本进程有效，这是单主本机应用的已知边界。

#### P3-5 备份 v5

- 格式版本 5（本节设计稿最初写 3，P2-3 增加 jobs/jobChunks 后升到 4，P2-7 增加 todos/goals 后升到 5；导入仍兼容 1–5）：`{ version, exportedAt, tables, events, checksum }`；事件表按会话分片导出；附件只带元数据；密钥仍置空。
- 流式导出（NDJSON/ZIP）避免全内存；分片上限 50MB；导出前 flush 活会话。
- 导入：校验 checksum/版本；事件按 `conversation_id, seq` 冲突跳过；P1-1 未引入 `next_seq`，导入后 seq 从 `max(seq)` 继续即可。
- 兼容：仍能导入 v1/v2；v3 导入旧版本时忽略 events。

验收：10 万消息导出内存 < 200MB；导入后事件/投影一致；校验和不匹配拒绝。

**实现状态（P3-5，部分）**：`checksum` 已加。摘要按**顶层键字典序**拼接每个表的 `JSON.stringify`，因此 `Promise.all` 的完成顺序不会改变结果；导入只在 `checksum` 存在时校验，缺字段的旧备份仍可导入。**NDJSON 流式导出已落地**（`server/api/export/ndjson.get.ts`）：响应 `application/x-ndjson`，先 `meta`，每表 `table` / 逐行 `row` / `tableEnd(count)`，最后 `end(checksum)`；`checksum` 是全部 `row` 行（含换行）的 sha256，与 JSON 备份的顶层摘要不是同一算法，但能验证传输完整性。`backup-builders.ts` 现在是 JSON/NDJSON 唯一的表清单与脱敏口径，冒烟测试第 13 节从它反查 schema 覆盖。**NDJSON 导入**（[backup-import-ndjson.ts](../server/utils/backup-import-ndjson.ts) + `POST /api/import/ndjson`）：只接受 `mode=all` 的整机导出（单表分片缺其余表，明确 400），逐行解析 `meta/table/row/tableEnd/end`，校验表名属于 `backupTables`、不重复、行数与 `tableEnd.count` 一致、`end.checksum` 按 `{type:'row',table,row}\n` 重算一致，再把 `systemSettings` 折回单例并交给 `importWorkBackup()`；因此仍是同主键跳过、外键顺序、单事务、20MB 上限与 3 次/分限流。**单表游标分页**（[backup-pages.ts](../server/utils/backup-pages.ts)）：新增 `backupTables` 与 builder 键一一对应；游标是主键值 JSON 数组，按主键 `>` 排序取 `limit+1` 行判断 `hasMore`，`tableEnd` 回 `nextAfter`；复合主键按字典序逐列比较，游标列数不匹配直接拒绝。每页默认 500、上限 2000，`after` 只能与 `table` 同时使用。分页让单表内存峰值从「整表」降到「一页」，但整机模式仍是一次一张表；ZIP、50MB 自动分片、事件分片与导出前 flush 活会话未做，10 万消息内存目标未测。

#### P3-6 搜索索引

- `messages` 加 `content_text` 生成列（从 parts 提取文本）或写入时维护；`pg_trgm` GIN。
- 会话标题/知识库文档同样加 trgm 索引；`/api/search` 改为索引查询，保留 ILIKE 回退。
- 命令面板分组与键盘导航保留。

验收：中文 2 字子串可命中；P95 < 200ms；无索引时自动回退。

**实现状态（P3-6，基础版）**：`messages.content_text` 是普通列，不是生成列；聊天、定时任务、子代理、fork 五处写入都显式维护，漏一处该条消息就不会被全文搜到。`0013` 先 `CREATE EXTENSION IF NOT EXISTS pg_trgm`，再建三个 GIN 索引。旧数据回填是独立命令，未跑过就没有历史消息命中；无 `pg_trgm` 权限时迁移会失败，不会自动降级到 ILIKE。`/api/search` 仍用 `ILIKE '%q%'`，pg_trgm 对中文 2 字的实际命中与 P95 未做压测。

---

### P4（持续）：安全、性能、测试、文档

1. **认证（仅当需要非回环）**：启动 token → 签名 HttpOnly/SameSite=Strict cookie；区分 401（未认证）与 403（来源不可信）；`sec-fetch-site: cross-site` 拒绝。单机回环可保持现状，但文档必须写明“回环不是身份”。
2. **密钥加密**：`providers.api_key`、`storage_configs.secret_access_key`、MCP headers 用应用层 AES-GCM（主密钥来自 `WORK_SECRET_KEY` 或 OS keychain），迁移时双读。
3. **限流覆盖**：所有写端点 + 外呼端点；Redis 不可用时内存降级已在，补指标。
4. **依赖与供应链**：`pnpm audit`、锁文件、CI 固定 Node/pnpm。
5. **性能**：会话列表分页/索引、事件表分区（按 `created_at` 月分区，后期）、N+1 审计、SSE 背压。
6. **测试**：见第 9 节；每季度迁移演练（备份→空库→迁移→导入）。
7. **文档**：AGENTS.md 同步；ADR 记录“为什么不用 Cordis/DSH 运行时”“为什么 shell 不是沙箱”。

**实现状态（P4，部分）**：密钥加密已落地到 `providers.api_key`、`storage_configs.secret_access_key` 与 MCP headers：[secret-box.ts](../server/utils/secret-box.ts) 用 AES-256-GCM（12 字节随机 IV、格式 `enc:v1:<iv>:<tag>:<ct>`），主密钥为 `WORK_SECRET_KEY`（64 位 hex 或 base64 32 字节）；未配置时保持明文以兼容旧库，密文但在无密钥时读取会 500 而不是把密文当 Key 发出去。`WORK_SECRET_KEY_OLD` 支持轮换期双读；重新保存一次即换钥。供应商与存储的列表/详情、`resolveModel`、嵌入、KB 摄入、S3 客户端都在读出后解密，掩码基于明文。MCP headers 由 [mcp.ts](../server/utils/mcp.ts) 的 `sealHeaders/openHeaders` 逐项加密（键名保留明文、空值不加密、旧明文兼容），保存时 `normalize → merge → seal`，建连（聊天/定时任务/工具列表）前解密；编辑页回传 `****` 时 `mergeHeaders` 保留原密文，不会把真实值覆盖成掩码。**历史明文批量加密**：[secret-migration.ts](../server/utils/secret-migration.ts) 与 `pnpm --filter @repo/work secrets:encrypt`（`--dry-run`）扫描上述四类凭据，只处理明文、已加密行跳过，写入前做 `openSecret(sealSecret(v)) === v` 自校验；未配置主密钥时一个字节都不写。故意做成显式 CLI 而不是启动时自动改写：启动写库会把「钥配错」变成一次不可逆的批量迁移。**限流指标**：[rate-limit.ts](../server/utils/rate-limit.ts) 的 `rateLimit()` 在 Redis 与内存降级两条路径都记账，按 key 第一段（`export`/`chat`/`kb-reindex`）聚合 `calls/allowed/blocked/memoryFallback/redisErrors`，族数上限 200、超出归入 `other`，避免把知识库 id 变成指标基数；`GET /api/metrics/rate-limit` 只读返回，自己不经过 `rateLimit()`。指标是进程内、重启清零，多实例各一份。**负载基线**：[bench.ts](../scripts/bench.ts)（`pnpm --filter @repo/work bench -- --n=15`）对开发构建、小库串行采样，输出四项场景的 p50/p95：`projection 1000 events` 0.1/0.5ms、`GET /api/sessions` 15.5/19.4ms、`GET /api/overview` 15.9/35.5ms、`GET /api/search` 15.4/22.3ms。这只是改动前后对比的冒烟基线，不是 1 万会话/1 万 chunk 的容量证明。**未做**：OS keychain、启动时自动重加密、认证（回环部署按设计不启用）、真实规模负载。

---

## 7. 关键设计细节

### 7.1 事件投影伪代码

```ts
type Event = { seq: number; type: string; data: any; surfaceOp?: SurfaceOp };

function deriveMessages(events: Event[]): ModelMessage[] {
    const hidden = new Set<number>();
    for (const e of events) {
        if (e.surfaceOp?.op === 'replace') {
            for (let s = e.surfaceOp.fromSeq; s <= e.surfaceOp.toSeq; s++) hidden.add(s);
        }
    }
    const out: ModelMessage[] = [];
    for (const e of events) {
        if (hidden.has(e.seq)) continue;
        switch (e.type) {
            case 'system/message':
            case 'user/message':
            case 'assistant/message':
                out.push(toModelMessage(e));
                break;
            case 'tool/result':
                attachToolResult(out, e);
                break;
            // request/header, compaction/*, approval/*, run/* 不进入历史
        }
    }
    return out;
}
```

注意：`assistant/message` 可能包含多个 tool call；`tool/result` 必须找到对应 call，找不到则补 `TOOL_OUTCOME_UNKNOWN`。

### 7.2 turn/step 与 AI SDK 的映射

AI SDK 7 的 `streamText` 内部已有 step 循环（`stopWhen`），但没有 DSH 那样的 durable turn/step 事件。映射方式：

- 一次 `runTurn` = 一个 turn；`onStepFinish` = 一步结束；`prepareStep` = 下一步前。
- `request/header` 在 `streamText` 调用前写一次（含 model/system/tools/maxSteps）。
- 每个 `onStepFinish` 写 `assistant/message`（含 usage）+ `tool/result`（该步工具）。
- 工具执行用包装函数：`execute: async (input, opts) => dispatchTool(...)`，在内部做审批/超时/截断/事件。
- 取消：`AbortController` 传入 `streamText({ abortSignal })`；工具内部 `signal` 透传。
- 失败：`onError` 写 `run/end(status='failed')`；已产出文本仍保存（与现状一致）。

不要试图在 AI SDK 外面再造一个完整 step 状态机；先做到“事件可恢复、工具可审计”，再考虑重试/attempt。

### 7.3 压缩边界与工具配对

```ts
function chooseCompactionRange(messages, budget): Range {
    let start = 0;
    // 跳过 system node 0
    while (messages[start]?.role === 'system') start++;
    let end = messages.length - 1;
    let kept = 0;
    while (end >= start && kept < budget * retainRatio) {
        kept += estimate(messages[end]);
        end--;
    }
    // 对齐：如果 end 落在 tool call/result 之间，向前/向后扩到成对
    while (end > start && isToolBoundary(messages, end)) end--;
    return { from: start, to: end };
}
```

压缩摘要提示词要明确“只总结已发生的事实；不要执行新操作；保留未完成事项与关键数字”。压缩后把摘要作为 `system/message(source:'compaction')`，而不是 user（避免模型把它当新指令）。

### 7.4 审批状态机

```
pending ──allow──> allowed ──execute──> result
   │
   ├──reject──> rejected
   ├──timeout─> expired
   └──cancel──> cancelled
```

- `allowed` 只对本次调用有效，不记忆规则。
- 审批请求里不放完整敏感参数（如密钥），只放摘要；模型看不到审批详情。
- `never` 模式在 dispatch 前直接拒绝，不创建 pending。

### 7.5 路径围栏与 shell 的边界

- 文件：`realpath` + 根前缀 + 拒绝符号链接 + 大小写归一；这是**应用层围栏**，不是内核边界。
- shell：只能保证 cwd、环境变量、超时、输出上限、审批；**不能保证**命令不访问网络/不读其他目录。必须在设置页写明，并要求用户显式开启。
- 如果未来要更强隔离：Windows Job Object + 受限 token、Unix bubblewrap/Landlock；这是 P4 之后的独立项目，不放进本次整改。

### 7.6 jobs 与 schedule 的分工

|          | `automation_runs`  | `jobs`                       |
| -------- | ------------------ | ---------------------------- |
| 语义     | 定时任务“跑过什么” | 当前进程“正在跑什么”         |
| 生命周期 | 持久、可查历史     | 多数短命，重启标 interrupted |
| 输出     | 会话 + 摘要/错误   | 增量 stdout/stderr           |
| 触发     | cron tick / 手动   | 工具调用                     |

不要用 `automation_runs` 存 job 输出，也不要用 jobs 替定时任务历史。

### 7.7 技能加载

```
system prompt:
  可用技能（名称 + 一句话）：
  - code-review: 审查 diff 并给出阻断项
  - weekly-report: 汇总本周会话

model: skill_load("code-review")
  → 返回 SKILL.md 正文
```

- 目录注入只放 name/description；正文按需。
- `/name` 由前端拦截，直接把正文作为 `system/message(source:'skill')` 注入，不经过模型选择。
- 技能正文上限 64KB；超长截断并提示。

### 7.8 调度重试状态

```
occurrence at T:
  nextRunAt = T+period (先推进)
  attempt=1 → 失败 → nextAttemptAt = now+60s
  attempt=2 → 失败 → nextAttemptAt = now+5min
  attempt=3 → 失败 → status=failed, deadLetterAt=now
  下一次 occurrence 仍按 nextRunAt 正常跑
```

手动运行：`Idempotency-Key` + `session_runs` 唯一约束，两个标签页只有一个成功，另一个 409。

### 7.9 搜索

- 中文：`pg_trgm` 的 GIN 对 `ILIKE '%词%'` 有效；`tsvector` 对中文分词差，不作为主路径。
- 会话消息文本提取：写入时维护 `content_text`，避免每次 `parts::text`。
- 结果去重：同一会话只返回最高分片段 + 命中数。

### 7.10 SSE 协议

```
event: snapshot
data: {"asOfSeq":123,"messages":[...],"run":{...}}

id: 124
event: session-event
data: {"seq":124,"type":"assistant/message","data":{...}}

event: approval-required
data: {"approvalId":"...","tool":"fs_write","risk":"write"}

event: run-end
data: {"status":"success","usage":{...}}
```

客户端：

1. 打开 `follow`，带 `Last-Event-ID`。
2. 收到 snapshot 后清空本地未确认消息（按 `requestId` 匹配保留 pending）。
3. 按 `seq` 去重；发现 `seq > last+1` 重新拉 snapshot。
4. `approval-required` 弹卡；`run-end` 清 pending。

---

## 8. 数据迁移、兼容与回滚

### 8.1 迁移顺序

1. **扩展**（已完成）：加 `session_events` 表/索引，不改旧读写；`0008_closed_ego.sql` 只新增，无 `next_seq` 列。
2. **双写**（已完成，旁路）：`/api/chat` 在 `messages` 落库后 best-effort 写 `session_events`；读仍走 `messages`，事件失败只记日志。
3. **回填**（已完成）：`backfill-session-events.ts` 按 `data.id` 幂等跑完，并对每个会话投影对账。
4. **切读**（未开始）：`WORK_SESSION_ENGINE=events` 打开；出问题回 `legacy`。切换前必须先补工具调用配对与 usage。
5. **收缩**（未开始）：稳定 2 个版本后，`messages` 只作为投影/缓存，不再作为真相；暂不删表。

### 8.2 兼容

- 旧 `/api/chat` 保持响应格式；内部走新 runtime。
- 旧导出 v2 仍可导入；新导出 v3 带 events；旧版本忽略 events。
- 旧客户端（移动端？work 只有 Web）不受影响；work 没有移动端。

### 8.3 回滚

- 每个阶段有环境变量开关：`WORK_SESSION_ENGINE`、`WORK_VECTOR_BACKEND`、`WORK_ENABLE_SHELL`、`WORK_APPROVAL_MODE`。
- 迁移只加不删；回滚 = 关开关 + 保留新表。
- 数据修复脚本必须可 dry-run，先输出影响行数。

---

## 9. 测试与验收

### 9.1 单元测试（纯函数，tsx/vitest）

- `deriveMessages`：replace 遮蔽、工具配对、未知类型拒绝。
- `chooseCompactionRange`：边界、保留比例、system 保护。
- `estimateTokens`/预算分配。
- `resolveInsideRoot`：穿越、符号链接、大小写、不存在父目录。
- `computeNextRunAt`：闰日、跨年、午夜、DST（北京无 DST，但时区字段要测）。
- 审批状态机：allow/reject/timeout/cancel。
- 错误码映射：每个 code 都有 i18n。

### 9.2 集成测试（真实 Postgres，测试库）

- 发一轮 prompt → 事件序列 → 投影 → 消息。
- 中途 kill 进程 → 重启 → interrupted + `TOOL_OUTCOME_UNKNOWN`。
- 压缩后继续请求；工具配对不破。
- 审批允许/拒绝/超时。
- 两个 worker 同时 tick → 只认领一次。
- 两个标签页 follow → 都收到增量；重连去重。
- 导出 v3 → 空库导入 → 投影一致。

### 9.3 E2E（Playwright）

- 新建会话 → 发消息 → 工具卡 → 审批 → 继续 → 刷新续流。
- 空间内读写文件 → diff → present → 下载。
- 定时任务创建 → 手动运行 → 运行中心 → 取消。
- 知识库上传 → 检索 → 引用跳转。

### 9.4 性能基线

| 指标                 | 目标        |
| -------------------- | ----------- |
| 会话列表（1 万会话） | P95 < 100ms |
| 事件追加             | P95 < 20ms  |
| 投影 1000 事件       | < 50ms      |
| 压缩 100K token      | < 30s       |
| 向量检索 1 万 chunk  | P95 < 100ms |
| 搜索 1 万消息        | P95 < 200ms |
| SSE 首事件           | < 500ms     |

### 9.5 安全 checklist

每次发版/季度复核按这张表逐项过；状态为 **本次（2026-10-19）** 的实际核对结果，不是一次性的口号。

| 检查项 | 现状 | 证据 / 已知缺口 |
| --- | --- | --- |
| 路径穿越/符号链接/UNC/大小写 | ✅ 只读与写工具都先 `realpath` 再比对白名单 | `local-files.ts`；冒烟测试覆盖越界与符号链接 |
| SSRF：私网、回环、重定向、DNS 重绑定 | ✅ 默认关闭；`web_fetch` 拒绝私网/回环并逐跳复核重定向 | 未做 DNS 重绑定专项实测 |
| Origin/CSRF：外站写 403；GET 不回显敏感数据 | ✅ `blocksWrite` 只拦写；读接口不返回密钥明文 | 冒烟测试 + 真实 HTTP |
| 密钥：API 响应脱敏、导出脱敏、日志不打印 | ✅ 供应商/存储/MCP headers 掩码；JSON/NDJSON 导出置空/折叠 | P4 真实 HTTP 验证；`secrets:encrypt --dry-run` 只读 |
| 限流：写/外呼端点 | ✅ 写接口与导出/导入/重建/手动运行均有限流；指标只读 | `GET /api/metrics/rate-limit`；进程内、重启清零 |
| 审批：无 answerer 失败关闭 | ✅ `ask` 非读工具挂起；定时任务 `noAnswerer:true` 立即拒绝 | 冒烟测试断言；真实 MCP 审批未端到端跑 |
| Shell：默认关闭、显式风险提示、审批 | ✅ `WORK_COMMAND_ENABLED=1` 才注入；`run_command` 等进审批 | 未在公网/非回环场景验证 |
| 非回环绑定 | ⚠️ 必须显式 `WORK_ALLOW_PUBLIC_BIND=true` 才降为告警，**且没有内置认证** | **公网部署前必须先加 token/cookie 认证**；当前按本机回环设计 |
| 备份恢复 | ✅ 密钥/向量/附件二进制不在文件；NDJSON checksum 校验；空库迁移演练通过 | 附件桶与知识库索引需另行恢复 |
| 依赖与供应链 | ⏳ 锁文件、CI 固定 Node/pnpm、h3 精确钉版 | `pnpm audit` 尚未纳入 CI；依赖升级仍需人工看 engines |
| 迁移演练 | ✅ 备份 → 空库 → 18 条迁移 → 导入 → 计数校验 → 删库 | 2026-10-19 本机真实执行；未在生产副本上跑 |

---

## 10. 工作量、风险与决策记录

### 10.1 工作量（单人，含测试/文档）

| 阶段     | 内容                                                                  | 人日           |
| -------- | --------------------------------------------------------------------- | -------------- |
| P0       | 文档、依赖、CI、runtime 抽取、run 表、requestId                       | 6–8            |
| P1       | 事件表/投影/回填、检查点、token/压缩、审批、registry、UI              | 18–22          |
| P2       | 文件读写、shell、jobs、subagent、skills、web、todo/plan、session 搜索 | 28–35          |
| P3       | API v2、时间线/交付物、pgvector、调度加固、备份 v3、搜索索引          | 18–24          |
| P4       | 安全/性能/测试/文档                                                   | 持续 5/季度    |
| **合计** |                                                                       | **70–89 人日** |

假设：1 名熟悉该仓库的工程师；不含 UI 视觉重设计；不含 DSH sidecar spike。

### 10.2 风险

| 风险                 | 概率/影响 | 缓解                                                                       |
| -------------------- | --------- | -------------------------------------------------------------------------- |
| 事件双写不一致       | 中/高     | 同事务；`WORK_SESSION_ENGINE` 开关；回填校验；先只写事件再投影             |
| 压缩丢关键信息       | 中/中     | 保留最近 30%；摘要提示词；原事件不删；可手动重压缩                         |
| AI SDK step 钩子不足 | 中/中     | 先用 `onStepFinish`/`prepareStep` + 工具包装；必要时升级 AI SDK 或自管循环 |
| shell 安全           | 高/高     | 默认关闭；审批；cwd/环境/超时/输出上限；明确“非沙箱”；P4 再评估强隔离      |
| 迁移窗口长           | 中/中     | 扩展-收缩；旧读路径保留两个版本；每步可回滚                                |
| pgvector 不可用      | 中/低     | JSONB 回退；启动探测；UI 提示                                              |
| 范围膨胀             | 高/中     | 严格按 P0–P3；workflow/agent team/terminal 明确不做                        |
| 许可证               | 低/中     | 不复制 DSH 代码，只实现语义；若引入 SDK 先确认许可证                       |

### 10.3 决策记录（ADR 摘要）

- **ADR-001**：会话采用“事件日志 + 投影”，`messages` 降级为投影；理由是可恢复、可审计、可压缩、可 fork；代价是迁移与双写。
- **ADR-002**：不引入 Cordis/DSH 运行时；理由是 `dsh-base` 非库、Cordis 生命周期与 Nuxt 冲突、数据双份、许可证未知。
- **ADR-003**：shell 默认关闭，定位为“受控便利”而非“安全沙箱”；理由是单主本机 + 应用层围栏无法提供内核级保证。
- **ADR-004**：压缩摘要用 `system/message` 而非 user；理由是避免模型把摘要当新指令。
- **ADR-005**：审批只做一次性 allow-once，不做 allow-always；理由是规则记忆会绕开风险提示，work 单用户也不需要复杂策略。

---

## 11. 附录

### 11.1 关键文件改动清单

| 文件                                                          | 阶段  | 改动                                            |
| ------------------------------------------------------------- | ----- | ----------------------------------------------- |
| [AGENTS.md](../../../AGENTS.md)                               | P0    | work 节纠偏                                     |
| [pnpm-workspace.yaml](../../../pnpm-workspace.yaml)           | P0    | `overrides.h3`（pnpm 12 不读根 package.json）   |
| [packages/work/package.json](../package.json)                 | P0    | h3 精确版本、清依赖                             |
| [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) | P0    | work verify job                                 |
| [runtime.ts](../server/agent/runtime.ts)                      | P0    | `loadAgentCapabilities()`，聊天/定时共用        |
| [session-runs.ts](../server/utils/session-runs.ts)            | P0    | `session_runs` 生命周期与启动清理               |
| [00-request-id.ts](../server/middleware/00-request-id.ts)     | P0    | `x-request-id` 分配/透传                        |
| [error.ts](../server/error.ts)                                | P0    | `nitro.errorHandler` 错误信封                   |
| [chat.ts](../server/api/chat.ts)                              | P0/P1 | 已调用 runtime；SSE 适配器继续瘦身              |
| [schedule-runner.ts](../server/utils/schedule-runner.ts)      | P0/P1 | 已调用 runtime；P3 重试/取消                    |
| [schema.ts](../server/db/schema.ts)                           | P0–P3 | `session_runs`、`session_events`、`approvals`、`jobs`/`job_chunks` 已加 |
| [chat-runs.ts](../server/utils/chat-runs.ts)                  | P1    | 降级为投影，权威迁到事件                        |
| [system-prompt.ts](../server/utils/system-prompt.ts)          | P1/P2 | 技能目录、计划、todo、审批提示                  |
| [workbench-tools.ts](../server/utils/workbench-tools.ts)      | P1/P2 | 走 registry；新增工具                           |
| [local-files.ts](../server/utils/local-files.ts)              | P2    | 读写/glob/grep                                  |
| [mcp.ts](../server/utils/mcp.ts)                              | P2    | resources                                       |
| [export.get.ts](../server/api/export.get.ts)                  | P0/P3 | 已带 `sessionRuns`；P3 改 v3 流式               |
| [backup-import.ts](../server/utils/backup-import.ts)          | P3    | v3 兼容                                         |
| [ChatPane.vue](../app/components/ChatPane.vue)                | P1/P3 | 时间线/审批/上下文                              |
| [work-settings.ts](../app/utils/work-settings.ts)             | P2    | 新增“执行/审批”设置页                           |

### 11.2 新增 API 一览

```
POST   /api/sessions
GET    /api/sessions
GET    /api/sessions/{id}/snapshot
GET    /api/sessions/{id}/events
GET    /api/sessions/{id}/follow
POST   /api/sessions/{id}/prompt
POST   /api/sessions/{id}/stop
POST   /api/sessions/{id}/compact
POST   /api/sessions/{id}/fork
POST   /api/approvals/{id}/decide
GET    /api/jobs
GET    /api/jobs/{id}
POST   /api/jobs/{id}/kill
POST   /api/schedules/{id}/runs/{runId}/cancel
```

### 11.3 DSH 包 → work 映射（摘要）

| DSH 包                           | work 对应/落点                           |
| -------------------------------- | ---------------------------------------- |
| `dsh-session` / `-persistence`   | `session_events` + `session_runs`        |
| `dsh-session-projection`         | `deriveMessages`                         |
| `dsh-session-query`              | `session_search` + `/api/search` 索引    |
| `dsh-agent-loop`                 | `agent/runtime.ts`                       |
| `dsh-tools`                      | `agent/tools/registry.ts`                |
| `dsh-tool-fs` / `-fs-search`     | `fs_read/write/edit/glob/grep`           |
| `dsh-tool-bash`                  | `run_command`（默认关闭）                |
| `dsh-jobs`                       | `jobs` + `job_chunks`                    |
| `dsh-tool-subagent`              | `subagent` 工具 + 父子会话               |
| `dsh-tool-skill` / `-filesystem` | `WORK_SKILL_ROOTS` + `skill_load`        |
| `dsh-tool-web`                   | `web_search` / `web_fetch`               |
| `dsh-user-approval`              | `approvals` + 审批卡                     |
| `dsh-compaction` / `-basic`      | `compaction/*` 事件 + 摘要               |
| `dsh-token-meter`                | `token-meter.ts` + ContextMeter          |
| `dsh-tool-todo` / `-plan-mode`   | `todos` + `/plan`                        |
| `dsh-goal`                       | `goals`（后置，不自动续跑）              |
| `dsh-schedule`                   | 只借 CAS/重试/取消，不换语义             |
| `dsh-mcp-resources`              | MCP resources 工具                       |
| `dsh-client-connection`          | 若开放非回环：token/cookie、401/403 分离 |
| `dsh-sandbox*`                   | 不引入；用应用层 path-guard + 审批       |

### 11.4 术语

- **事件**：append-only 的会话记录，带 `seq`。
- **投影**：从事件折叠出的消息列表。
- **压缩**：用摘要替换旧事件区间的 surface。
- **检查点**：在模型请求/工具执行前提交事件。
- **审批**：一次性 allow-once 的人机确认。
- **工作区**：`spaces.local_root` 指向的本地目录。
- **运行**：一次 turn（聊天一轮/定时任务一次/子代理一次）。

---

> 本文只做方案分析，未运行构建、未执行迁移、未调用模型。所有代码引用以当前工作区为准；DSH 描述以包 README 为准，未读其源码。
