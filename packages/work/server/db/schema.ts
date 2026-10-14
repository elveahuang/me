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
// 工作台：项目 / 任务 / 笔记 / 日程 / 每日简报
// ==========================================
// work 是单主的本机应用，这些表刻意没有归属列。

export const TASK_STATUSES = ['todo', 'doing', 'done', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export const WORK_SOURCES = ['manual', 'ai', 'brief'] as const;
export const NOTE_KINDS = ['note', 'daily'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type WorkSource = (typeof WORK_SOURCES)[number];

export const projects = pgTable('projects', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    color: text('color').notNull().default(''),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const tasks = pgTable(
    'tasks',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
        title: text('title').notNull(),
        detail: text('detail').notNull().default(''),
        status: text('status').notNull().default('todo'),
        priority: text('priority').notNull().default('medium'),
        dueAt: timestamp('due_at'),
        completedAt: timestamp('completed_at'),
        // 任务由谁产生：用户手敲 / 助手工具写入 / 简报建议
        source: text('source').notNull().default('manual'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [index('tasks_status_due_idx').on(t.status, t.dueAt), index('tasks_project_idx').on(t.projectId)],
);

export const notes = pgTable(
    'notes',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
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

export const events = pgTable(
    'events',
    {
        id: text('id').primaryKey(),
        projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
        title: text('title').notNull(),
        detail: text('detail').notNull().default(''),
        startsAt: timestamp('starts_at').notNull(),
        endsAt: timestamp('ends_at'),
        allDay: boolean('all_day').notNull().default(false),
        location: text('location').notNull().default(''),
        reminderAt: timestamp('reminder_at'),
        source: text('source').notNull().default('manual'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [index('events_starts_at_idx').on(t.startsAt)],
);

/**
 * 每日简报。主键就是日期：定时任务重复触发时靠 upsert 天然幂等，
 * 多实例各跑一次也只是重写同一天。
 */
export const briefs = pgTable('briefs', {
    briefDate: date('brief_date').primaryKey(),
    // 模型产出的 Markdown 正文
    content: text('content').notNull().default(''),
    // 生成时的结构化快照（到期/逾期/进行中/日程），正文丢了也能重建
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    model: text('model').notNull().default(''),
    generatedAt: timestamp('generated_at').notNull().defaultNow(),
});

export const projectsRelations = relations(projects, ({ many }) => ({
    tasks: many(tasks),
    notes: many(notes),
    events: many(events),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
    project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
    project: one(projects, { fields: [notes.projectId], references: [projects.id] }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
    project: one(projects, { fields: [events.projectId], references: [projects.id] }),
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
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type WorkEvent = typeof events.$inferSelect;
export type Brief = typeof briefs.$inferSelect;
