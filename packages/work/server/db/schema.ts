import { relations } from 'drizzle-orm';
import { bigserial, boolean, date, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp } from 'drizzle-orm/pg-core';

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

export const agentsRelations = relations(agents, ({ many }) => ({
    agentSkills: many(agentSkills),
    agentTools: many(agentTools),
    conversations: many(conversations),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
    agentSkills: many(agentSkills),
}));

export const agentSkillsRelations = relations(agentSkills, ({ one }) => ({
    agent: one(agents, { fields: [agentSkills.agentId], references: [agents.id] }),
    skill: one(skills, { fields: [agentSkills.skillId], references: [skills.id] }),
}));

export const toolsRelations = relations(tools, ({ many }) => ({
    agentTools: many(agentTools),
}));

export const agentToolsRelations = relations(agentTools, ({ one }) => ({
    agent: one(agents, { fields: [agentTools.agentId], references: [agents.id] }),
    tool: one(tools, { fields: [agentTools.toolId], references: [tools.id] }),
}));

// ==========================================
// RAG KNOWLEDGE BASES
// ==========================================
export const knowledgeBases = pgTable('knowledge_bases', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    embeddingProviderId: text('embedding_provider_id').references(() => providers.id, {
        onDelete: 'set null',
    }),
    embeddingModel: text('embedding_model').notNull().default('text-embedding-3-small'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const kbDocuments = pgTable('kb_documents', {
    id: text('id').primaryKey(),
    kbId: text('kb_id')
        .notNull()
        .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    chunkCount: integer('chunk_count').notNull().default(0),
    status: text('status').notNull().default('ready'), // processing | ready | failed
    createdAt: timestamp('created_at').notNull().defaultNow(),
});

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
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (table) => [index('conversations_agent_id_idx').on(table.agentId)],
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
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    // 会话内消息按 seq 排序读取（窗口历史 / 分页），复合索引同时覆盖 conversation_id 等值过滤
    (table) => [index('messages_conversation_seq_idx').on(table.conversationId, table.seq)],
);

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
    agent: one(agents, { fields: [conversations.agentId], references: [agents.id] }),
    messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
    conversation: one(conversations, {
        fields: [messages.conversationId],
        references: [conversations.id],
    }),
}));

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
    (t) => [index('attachments_created_at_idx').on(t.createdAt)],
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
// 工作台：笔记 / 定时任务 / 每日简报
// ==========================================
// work 是单主的本机应用，这些表刻意没有归属列。
//
// 待办（tasks）、项目（projects）与日程（events）已整体退场：工作台只剩「记东西」和
// 「到点自动跑智能体」两种能力，`schedules` 取代的就是原来「任务 + 日历」的位置。

export const NOTE_KINDS = ['note', 'daily'] as const;

/**
 * 定时任务的重复口径。
 *
 * 刻意不做 cron 表达式：croner 按**进程本地时区**解释表达式，容器几乎都是 UTC，
 * 于是「每天 09:00」会在北京时间 17:00 跑（`brief:daily` 为此每小时自判北京日，见 nuxt.config）。
 * 这里把「北京时间几点 / 星期几」存成结构化字段，下一次时刻由 `work-schedule.ts` 自己按北京日算，
 * 用户看到的是「每天 09:00」而不是一个需要查表的表达式。
 */
export const SCHEDULE_KINDS = ['once', 'interval', 'daily', 'weekly'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** `lastStatus` 的空串是「还没跑过」，与界面显示 `-` 对应；`running` 只在那一轮真正在途时出现。 */
export const SCHEDULE_STATUSES = ['running', 'success', 'failed'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const notes = pgTable(
    'notes',
    {
        id: text('id').primaryKey(),
        title: text('title').notNull().default(''),
        // Markdown 正文，与编辑器/导出同一套
        content: text('content').notNull().default(''),
        kind: text('kind').notNull().default('note'),
        pinned: boolean('pinned').notNull().default(false),
        tags: jsonb('tags').$type<string[]>().notNull().default([]),
        // AI 摘要：检索命中后用于回喂上下文，避免整篇塞进提示词
        summary: text('summary').notNull().default(''),
        embedding: jsonb('embedding').$type<number[]>(),
        embeddingModel: text('embedding_model'),
        embeddingDim: integer('embedding_dim'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [index('notes_updated_at_idx').on(t.updatedAt), index('notes_kind_idx').on(t.kind)],
);

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
    (t) => [index('schedules_enabled_next_idx').on(t.enabled, t.nextRunAt)],
);

/**
 * 每日简报。主键就是日期：定时任务重复触发时靠 upsert 天然幂等，
 * 多实例各跑一次也只是重写同一天。
 */
export const briefs = pgTable('briefs', {
    briefDate: date('brief_date').primaryKey(),
    // 模型产出的 Markdown 正文
    content: text('content').notNull().default(''),
    // 生成时的结构化快照（今天到期/今天跑过/未来 7 天/最近笔记 + 四个计数），正文丢了也能重建
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    model: text('model').notNull().default(''),
    generatedAt: timestamp('generated_at').notNull().defaultNow(),
});

export const schedulesRelations = relations(schedules, ({ one }) => ({
    agent: one(agents, { fields: [schedules.agentId], references: [agents.id] }),
}));

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
export type Note = typeof notes.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type Brief = typeof briefs.$inferSelect;
