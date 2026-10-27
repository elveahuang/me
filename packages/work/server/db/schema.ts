import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, customType, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** pgvector 列：维度固定 1536（text-embedding-3-small / 常见兼容模型）。 */
const vector1536 = customType<{ data: number[]; driverData: string }>({
    dataType() {
        return 'vector(1536)';
    },
    toDriver(value) {
        return `[${value.join(',')}]`;
    },
    fromDriver(value) {
        return String(value)
            .replace(/^\[|\]$/g, '')
            .split(',')
            .filter(Boolean)
            .map(Number);
    },
});

// ==========================================
// MODEL PROVIDERS（自定义供应商，OpenAI 兼容）
// ==========================================
export const providers = pgTable('providers', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    apiKey: text('api_key').notNull().default(''),
    models: jsonb('models').$type<string[]>().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ==========================================
// SPACES（个人工作空间）
// ==========================================
// 工作空间是会话、资料与自动化的长期上下文。work 是单主应用，因此没有 owner 列；
// 默认空间固定使用 id='default'，旧会话在迁移时全部回填到这里。
export const DEFAULT_SPACE_ID = 'default';

export const spaces = pgTable('spaces', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default('🗂️'),
    instructions: text('instructions').notNull().default(''),
    defaultAgentId: text('default_agent_id'),
    localRoot: text('local_root').notNull().default(''),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ==========================================
// AGENTS & SKILLS & TOOLS
// ==========================================
// Skill：可复用的指令块。挂载到智能体后其 instructions 会注入系统提示词，本身不可执行。
export const skills = pgTable('skills', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    instructions: text('instructions').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const APPROVAL_MODES = ['auto', 'ask', 'never'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const agents = pgTable('agents', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    emoji: text('emoji').notNull().default('🤖'),
    avatar: text('avatar'),
    description: text('description').notNull().default(''),
    systemPrompt: text('system_prompt').notNull().default(''),
    model: text('model').notNull().default('deepseek-chat'),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    temperature: real('temperature').default(0.7),
    maxTokens: integer('max_tokens'),
    maxSteps: integer('max_steps').notNull().default(6),
    /** auto：读与空间内写自动；ask：写/执行询问；never：只读助手，拒绝一切非读工具 */
    approvalMode: text('approval_mode').$type<ApprovalMode>().notNull().default('auto'),
    // 允许智能体通过 self-config 工具自主调整模型与 Skill
    selfConfig: boolean('self_config').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const agentSkills = pgTable(
    'agent_skills',
    {
        agentId: text('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        skillId: text('skill_id')
            .notNull()
            .references(() => skills.id, { onDelete: 'cascade' }),
    },
    (table) => [primaryKey({ columns: [table.agentId, table.skillId] })],
);

// Tool：AI SDK tool calling 工具。
// builtin_time = 内置查询当前时间；http = 后台配置的自定义 HTTP 端点。
export const tools = pgTable('tools', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    type: text('type').notNull().default('builtin_time'),
    // http 工具配置：{ url, method, headers, bodyTemplate, parameters: [{name,type,description,required}] }
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const agentTools = pgTable(
    'agent_tools',
    {
        agentId: text('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        toolId: text('tool_id')
            .notNull()
            .references(() => tools.id, { onDelete: 'cascade' }),
    },
    (table) => [primaryKey({ columns: [table.agentId, table.toolId] })],
);

// ==========================================
// MCP SERVERS（Model Context Protocol 工具服务）
// ==========================================
export const mcpServers = pgTable('mcp_servers', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    transport: text('transport').notNull().default('http'), // http | sse
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const agentMcpServers = pgTable(
    'agent_mcp_servers',
    {
        agentId: text('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        mcpServerId: text('mcp_server_id')
            .notNull()
            .references(() => mcpServers.id, { onDelete: 'cascade' }),
    },
    (table) => [primaryKey({ columns: [table.agentId, table.mcpServerId] })],
);

// ==========================================
// RAG KNOWLEDGE BASES
// ==========================================
export const knowledgeBases = pgTable(
    'knowledge_bases',
    {
        id: text('id').primaryKey(),
        spaceId: text('space_id').references(() => spaces.id, { onDelete: 'set null' }),
        name: text('name').notNull(),
        description: text('description').notNull().default(''),
        embeddingProviderId: text('embedding_provider_id').references(() => providers.id, {
            onDelete: 'set null',
        }),
        embeddingModel: text('embedding_model').notNull().default('text-embedding-3-small'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [index('knowledge_bases_space_idx').on(t.spaceId)],
);

export const kbDocuments = pgTable(
    'kb_documents',
    {
        id: text('id').primaryKey(),
        kbId: text('kb_id')
            .notNull()
            .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
        title: text('title').notNull(),
        content: text('content').notNull(),
        chunkCount: integer('chunk_count').notNull().default(0),
        status: text('status').notNull().default('ready'), // processing | ready | failed
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (table) => [index('kb_documents_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`)],
);
export const kbChunks = pgTable(
    'kb_chunks',
    {
        id: text('id').primaryKey(),
        kbId: text('kb_id')
            .notNull()
            .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
        documentId: text('document_id')
            .notNull()
            .references(() => kbDocuments.id, { onDelete: 'cascade' }),
        content: text('content').notNull(),
        embedding: jsonb('embedding').$type<number[]>().notNull().default([]),
        /** pgvector 影子列（P3-3）；只有 1536 维向量写入，非 1536 维仍走 JSONB */
        embeddingV: vector1536('embedding_v'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (table) => [index('kb_chunks_kb_id_idx').on(table.kbId), index('kb_chunks_document_id_idx').on(table.documentId)],
);

export const agentKnowledgeBases = pgTable(
    'agent_knowledge_bases',
    {
        agentId: text('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        kbId: text('kb_id')
            .notNull()
            .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    },
    (table) => [primaryKey({ columns: [table.agentId, table.kbId] })],
);

export const conversations = pgTable(
    'conversations',
    {
        id: text('id').primaryKey(),
        title: text('title').notNull().default('新对话'),
        agentId: text('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        spaceId: text('space_id').references(() => spaces.id, { onDelete: 'set null' }),
        /** 计划模式：本轮只出计划并等待确认；由输入框旁开关或 exit_plan_mode 关闭 */
        planMode: boolean('plan_mode').notNull().default(false),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (table) => [
        index('conversations_agent_id_idx').on(table.agentId),
        index('conversations_space_updated_idx').on(table.spaceId, table.updatedAt),
        index('conversations_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`),
    ],
);

export const messages = pgTable(
    'messages',
    {
        id: text('id').primaryKey(),
        // 全局递增序列，保证同一会话内消息排序稳定（createdAt 同秒会乱序）
        seq: bigserial('seq', { mode: 'number' }).notNull(),
        conversationId: text('conversation_id')
            .notNull()
            .references(() => conversations.id, { onDelete: 'cascade' }),
        role: text('role').notNull(), // 'user' | 'assistant'
        parts: jsonb('parts').$type<unknown[]>().notNull().default([]),
        /** parts 中 text 的拼接，供 pg_trgm 检索；写入时维护，旧行由 backfill 脚本补齐 */
        contentText: text('content_text').notNull().default(''),
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    // 会话内消息按 seq 排序读取（窗口历史 / 分页），复合索引同时覆盖 conversation_id 等值过滤
    (table) => [
        index('messages_conversation_seq_idx').on(table.conversationId, table.seq),
        index('messages_content_text_trgm_idx').using('gin', sql`${table.contentText} gin_trgm_ops`),
    ],
);

// ==========================================
// 会话运行台账（跨进程的「生成中」权威）
// ==========================================
// chat-runs.ts 的内存缓冲只覆盖「同一个 Nitro 进程还活着」的场景：重启、崩溃、或未来
// 多进程部署时，侧栏的「生成中」与启动清理都需要一个落库的来源。这张表只记运行生命周期，
// 不存正文/分片（正文仍由 messages 落库），因此可以安全地随整机备份导出。
export const SESSION_RUN_STATUSES = ['running', 'completed', 'failed', 'aborted', 'interrupted'] as const;
export type SessionRunStatus = (typeof SESSION_RUN_STATUSES)[number];

export const sessionRuns = pgTable(
    'session_runs',
    {
        id: text('id').primaryKey(),
        conversationId: text('conversation_id')
            .notNull()
            .references(() => conversations.id, { onDelete: 'cascade' }),
        /** 触发来源：chat（/api/chat）| schedule（预留；定时任务目前仍以 automation_runs 为权威） */
        trigger: text('trigger').notNull().default('chat'),
        status: text('status').notNull().default('running'),
        /** 请求关联 id，由 request-id 中间件注入；旧客户端/脚本可能为空 */
        requestId: text('request_id').notNull().default(''),
        /** 失败时的稳定错误码（不是供应商原文），便于日志与界面归类 */
        errorCode: text('error_code'),
        startedAt: timestamp('started_at').notNull().defaultNow(),
        finishedAt: timestamp('finished_at'),
    },
    (table) => [
        index('session_runs_conversation_started_idx').on(table.conversationId, table.startedAt),
        index('session_runs_status_idx').on(table.status),
        // P3-1 真正并发的同 requestId：应用层「先查再插」只能缓解，两个请求仍可同时通过检查。
        // 只对「在途/已完成 + 非空 requestId」建唯一索引：失败/中止的轮次允许用同一个 id 重试，
        // 旧客户端不带 requestId 的多轮（空串）也互不冲突。
        uniqueIndex('session_runs_request_active_idx')
            .on(table.conversationId, table.requestId)
            .where(sql`${table.requestId} <> '' AND ${table.status} IN ('running', 'completed')`),
    ],
);

// ==========================================
// 事件源会话（P1：append-only 事件日志）
// ==========================================
// `messages` 仍是当前的读模型；这张表先做「只追加的权威记录」，用于崩溃解释、审计与投影对账。
// 不把 `next_seq` 放到 conversations 上：首版用会话行锁 + max(seq) 分配，少一次迁移面；
// 等 P1-2 把写路径全部切过来时再决定是否物化计数器。
export const SESSION_EVENT_TYPES = [
    'user/message',
    'assistant/message',
    'system/message',
    'tool/call',
    'tool/result',
    'request/header',
    'run/start',
    'run/end',
    'compaction/start',
    'compaction/summary',
    'compaction/end',
    'approval/asked',
    'approval/decided',
    'todo/updated',
    'goal/updated',
    'plan/proposed',
    'plan/approved',
] as const;
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export type SessionSurfaceOp = { op: 'append' } | { op: 'replace'; fromSeq: number; toSeq: number };

// ==========================================
// APPROVALS（P1-4：危险工具审批）
// ==========================================
export const APPROVAL_RISKS = ['read', 'write', 'network', 'execute'] as const;
export type ApprovalRisk = (typeof APPROVAL_RISKS)[number];
export const APPROVAL_STATUSES = ['pending', 'allowed', 'rejected', 'cancelled', 'expired'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const approvals = pgTable(
    'approvals',
    {
        id: text('id').primaryKey(),
        conversationId: text('conversation_id')
            .notNull()
            .references(() => conversations.id, { onDelete: 'cascade' }),
        runId: text('run_id'),
        toolCallId: text('tool_call_id'),
        toolName: text('tool_name').notNull(),
        risk: text('risk').$type<ApprovalRisk>().notNull(),
        payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
        status: text('status').$type<ApprovalStatus>().notNull().default('pending'),
        reason: text('reason').notNull().default(''),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        decidedAt: timestamp('decided_at'),
    },
    (table) => [
        index('approvals_conversation_status_idx').on(table.conversationId, table.status),
        index('approvals_status_created_idx').on(table.status, table.createdAt),
    ],
);

// ==========================================
// JOBS（P2-3：后台命令）
// ==========================================
export const JOB_STATUSES = ['running', 'completed', 'failed', 'killed', 'interrupted'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobs = pgTable(
    'jobs',
    {
        id: text('id').primaryKey(),
        conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
        agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
        command: text('command').notNull(),
        cwd: text('cwd').notNull(),
        status: text('status').$type<JobStatus>().notNull().default('running'),
        pid: integer('pid'),
        exitCode: integer('exit_code'),
        error: text('error').notNull().default(''),
        outputBytes: integer('output_bytes').notNull().default(0),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        finishedAt: timestamp('finished_at'),
    },
    (table) => [index('jobs_status_created_idx').on(table.status, table.createdAt), index('jobs_conversation_idx').on(table.conversationId, table.createdAt)],
);

export const jobChunks = pgTable(
    'job_chunks',
    {
        id: text('id').primaryKey(),
        jobId: text('job_id')
            .notNull()
            .references(() => jobs.id, { onDelete: 'cascade' }),
        seq: bigserial('seq', { mode: 'number' }).notNull(),
        stream: text('stream').$type<'stdout' | 'stderr'>().notNull().default('stdout'),
        content: text('content').notNull(),
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (table) => [index('job_chunks_job_seq_idx').on(table.jobId, table.seq)],
);

export const sessionEvents = pgTable(
    'session_events',
    {
        conversationId: text('conversation_id')
            .notNull()
            .references(() => conversations.id, { onDelete: 'cascade' }),
        /** 单会话内严格递增、无空洞；由写入事务里的会话行锁保证串行 */
        seq: bigint('seq', { mode: 'number' }).notNull(),
        type: text('type').notNull(),
        turnId: text('turn_id'),
        stepId: text('step_id'),
        /** append 可省略；replace 表示该区间被压缩摘要遮蔽（原事件仍保留） */
        surfaceOp: jsonb('surface_op').$type<SessionSurfaceOp | null>(),
        /** 事件负载；消息类事件至少含 `id` 与 `parts`（或 `text`） */
        data: jsonb('data').$type<Record<string, unknown>>().notNull(),
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (table) => [primaryKey({ columns: [table.conversationId, table.seq] }), index('session_events_type_idx').on(table.type)],
);

// ==========================================
// OBJECT STORAGE（S3 协议：RustFS / MinIO / AWS S3 / 阿里云 OSS 等）
// ==========================================
// 附件本体存放在对象存储，数据库只保存元数据与对象 key。
// accessKeyId / secretAccessKey 属敏感字段，接口返回时必须脱敏（见 server/utils/s3.ts）。
export const storageConfigs = pgTable('storage_configs', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    provider: text('provider').notNull().default('s3'), // 预留多协议，当前仅 s3
    endpoint: text('endpoint').notNull(),
    region: text('region').notNull().default('us-east-1'),
    bucket: text('bucket').notNull(),
    accessKeyId: text('access_key_id').notNull().default(''),
    secretAccessKey: text('secret_access_key').notNull().default(''),
    // RustFS / MinIO 等自建存储通常只支持 path-style（http://host/bucket/key）
    forcePathStyle: boolean('force_path_style').notNull().default(true),
    // 公开访问前缀（CDN / 反向代理）。留空表示私有桶，下载走预签名 URL
    publicBaseUrl: text('public_base_url').notNull().default(''),
    prefix: text('prefix').notNull().default('uploads'),
    maxFileSizeMb: integer('max_file_size_mb').notNull().default(20),
    // 允许的 MIME 前缀白名单，如 ["image/", "application/pdf"]；空数组表示不限制
    allowedMimeTypes: jsonb('allowed_mime_types').$type<string[]>().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const attachments = pgTable(
    'attachments',
    {
        id: text('id').primaryKey(),
        spaceId: text('space_id').references(() => spaces.id, { onDelete: 'set null' }),
        storageConfigId: text('storage_config_id').references(() => storageConfigs.id, { onDelete: 'set null' }),
        // 对象存储中的 key（相对桶根路径）
        objectKey: text('object_key').notNull(),
        filename: text('filename').notNull(),
        mimeType: text('mime_type').notNull().default('application/octet-stream'),
        size: integer('size').notNull().default(0),
        // 业务分类：chat 会话附件 / avatar 头像 / document 文档 / image 图片 / other 其他
        category: text('category').notNull().default('other'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (t) => [index('attachments_created_at_idx').on(t.createdAt), index('attachments_space_created_idx').on(t.spaceId, t.createdAt)],
);

// ==========================================
// 会话交付物（P3-2）
// ==========================================
// 模型用 present 工具把本地白名单目录里的文件登记到当前会话。只存路径与元数据，
// 不复制二进制；下载时重新走 resolveAllowedPath，旧记录在目录被移出白名单后自动失效。
export const artifacts = pgTable(
    'artifacts',
    {
        id: text('id').primaryKey(),
        conversationId: text('conversation_id')
            .notNull()
            .references(() => conversations.id, { onDelete: 'cascade' }),
        title: text('title').notNull(),
        path: text('path').notNull(),
        mimeType: text('mime_type').notNull().default('application/octet-stream'),
        size: integer('size').notNull().default(0),
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (t) => [index('artifacts_conversation_created_idx').on(t.conversationId, t.createdAt)],
);

// ==========================================
// 系统基础设置（单行）
// ==========================================
// 平台级默认值：系统标题、新访客首访默认语言/主题。始终只有 id='default' 一行，
// 由 server/utils/system-settings.ts 负责读取（缺行时回退到内建默认）与 upsert。
export const systemSettings = pgTable('system_settings', {
    id: text('id').primaryKey(),
    siteTitle: text('site_title').notNull().default('WORK'),
    defaultLocale: text('default_locale').notNull().default('zh-CN'), // zh-CN | en-US
    themeMode: text('theme_mode').notNull().default('system'), // light | dark | system
    themeBrand: text('theme_brand').notNull().default('green'), // blue | green | yellow | red
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ==========================================
// 工作台：定时任务
// ==========================================
// work 是单主的本机应用，这些表刻意没有归属列。
//
// 待办（tasks）、项目（projects）、日程（events）已整体退场；笔记（notes）与每日简报（briefs）
// 紧随其后一起删除——侧栏收成「新建对话 + 定时任务」之后，这两块既没有展示位，
// 也不该留一个每天定时叫模型、结果没人看的生成任务。`schedules` 就是工作台唯一的「自动做的事」。

/**
 * 定时任务的重复口径。
 *
 * 刻意不做 cron 表达式：croner 按**进程本地时区**解释表达式，容器几乎都是 UTC，
 * 于是「每天 09:00」会在北京时间 17:00 跑。
 * 这里把「北京时间几点 / 星期几」存成结构化字段，下一次时刻由 `work-schedule.ts` 自己按北京日算，
 * 用户看到的是「每天 09:00」而不是一个需要查表的表达式。
 */
export const SCHEDULE_KINDS = ['once', 'interval', 'daily', 'weekly'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** `lastStatus` 的空串是「还没跑过」，与界面显示 `-` 对应；`running` 只在那一轮真正在途时出现。 */
export const SCHEDULE_STATUSES = ['running', 'success', 'failed'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/**
 * 定时任务：到点自动跑一轮智能体，并把结果落成一条会话。
 *
 * `startsAt` 与 `nextRunAt` 存绝对时刻（UTC timestamp），但**含义**按北京时间解释：
 * `timeText`/`days` 是「北京时间的几点、星期几」，`nextRunAt` 由 `work-schedule.ts` 按同一个
 * 时区口径算出，所以换机器、容器跑 UTC 都不会让「每天 09:00」漂移。
 * 每次写入（新建或 PATCH）都重算 `nextRunAt`，用户改完钟点不需要等下一轮 cron 才发现没生效。
 */
export const schedules = pgTable(
    'schedules',
    {
        id: text('id').primaryKey(),
        title: text('title').notNull(),
        // 到点发给智能体的那一条消息正文
        prompt: text('prompt').notNull().default(''),
        agentId: text('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        spaceId: text('space_id').references(() => spaces.id, { onDelete: 'set null' }),
        kind: text('kind').$type<ScheduleKind>().notNull().default('daily'),
        /** 'HH:mm'（北京时间）：once/daily/weekly 的钟点；interval 不用，留空串 */
        timeText: text('time_text').notNull().default(''),
        /** kind=interval 时的步长（分钟），其余为 null */
        intervalMinutes: integer('interval_minutes'),
        /** kind=weekly 时的星期（0=周日 … 6=周六，按北京日），其余为空数组 */
        days: jsonb('days').$type<number[]>().notNull().default([]),
        /** 首次生效时刻；once 就是它自己 */
        startsAt: timestamp('starts_at').notNull(),
        enabled: boolean('enabled').notNull().default(true),
        /** 乐观锁：PATCH 携带的 revision 与库内不一致时 409；每次成功写入 +1 */
        revision: integer('revision').notNull().default(0),
        /** 软删除标记：列表、详情、调度认领都过滤掉；运行记录仍保留 */
        deletedAt: timestamp('deleted_at'),
        nextRunAt: timestamp('next_run_at').notNull(),
        lastRunAt: timestamp('last_run_at'),
        lastStatus: text('last_status').$type<ScheduleStatus | ''>().notNull().default(''),
        lastError: text('last_error').notNull().default(''),
        /** 最近一轮跑出来的会话；删会话时置空，不连带删掉定时任务 */
        lastConversationId: text('last_conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    // runner 每分钟按 (enabled, nextRunAt) 取到期行，这条索引就是它的查询形状
    (t) => [index('schedules_enabled_next_idx').on(t.enabled, t.nextRunAt), index('schedules_space_idx').on(t.spaceId)],
);

// ==========================================
// AUTOMATION RUNS（自动化运行记录）
// ==========================================
export const AUTOMATION_RUN_STATUSES = ['running', 'success', 'failed'] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

/**
 * 每一轮自动化执行都留一条独立记录，`schedules.last_*` 只作为列表摘要缓存。
 * 这样列表页能回答「昨天那次为什么失败」，而不是被下一轮覆盖。
 */
export const automationRuns = pgTable(
    'automation_runs',
    {
        id: text('id').primaryKey(),
        scheduleId: text('schedule_id')
            .notNull()
            .references(() => schedules.id, { onDelete: 'cascade' }),
        status: text('status').$type<AutomationRunStatus>().notNull().default('running'),
        /** schedule | manual | retry */
        trigger: text('trigger').notNull().default('schedule'),
        scheduledFor: timestamp('scheduled_for'),
        startedAt: timestamp('started_at').notNull().defaultNow(),
        finishedAt: timestamp('finished_at'),
        durationMs: integer('duration_ms'),
        /** 本次实际发送给智能体的正文快照，任务被改动后仍能还原当时输入 */
        prompt: text('prompt').notNull().default(''),
        outputConversationId: text('output_conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
        error: text('error').notNull().default(''),
        attempt: integer('attempt').notNull().default(1),
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (table) => [
        index('automation_runs_schedule_started_idx').on(table.scheduleId, table.startedAt),
        index('automation_runs_status_started_idx').on(table.status, table.startedAt),
    ],
);

// ==========================================
// TODOS / GOALS（P2-7：会话级待办与目标）
// ==========================================
export const TODO_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];
export interface TodoItem {
    id: string;
    title: string;
    status: TodoStatus;
    note?: string;
}

/** 一个会话一份待办清单，`todo_write` 整表替换。 */
export const todos = pgTable('todos', {
    conversationId: text('conversation_id')
        .primaryKey()
        .references(() => conversations.id, { onDelete: 'cascade' }),
    items: jsonb('items').$type<TodoItem[]>().notNull().default([]),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const GOAL_STATUSES = ['active', 'paused', 'completed', 'blocked'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** 一个会话最多一个目标；revision 做乐观并发，`expectedRevision` 不匹配返回 409。 */
export const goals = pgTable('goals', {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
        .notNull()
        .unique()
        .references(() => conversations.id, { onDelete: 'cascade' }),
    objective: text('objective').notNull(),
    status: text('status').$type<GoalStatus>().notNull().default('active'),
    revision: integer('revision').notNull().default(1),
    round: integer('round').notNull().default(0),
    maxRounds: integer('max_rounds').notNull().default(10),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ==========================================
// INFERRED TYPES
// ==========================================
export type Agent = typeof agents.$inferSelect;
export type Skill = typeof skills.$inferSelect;
export type Tool = typeof tools.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type McpServer = typeof mcpServers.$inferSelect;
export type KnowledgeBase = typeof knowledgeBases.$inferSelect;
export type KbDocument = typeof kbDocuments.$inferSelect;
export type KbChunk = typeof kbChunks.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type StorageConfig = typeof storageConfigs.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type SystemSetting = typeof systemSettings.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type Goal = typeof goals.$inferSelect;
