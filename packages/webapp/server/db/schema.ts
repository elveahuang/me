import { relations } from 'drizzle-orm';
import { bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// ==========================================
// BETTER-AUTH CORE TABLES
// ==========================================
export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    // admin plugin
    role: text('role').notNull().default('user'),
    banned: boolean('banned'),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires'),
});

export const session = pgTable('session', {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
    // admin plugin
    impersonatedBy: text('impersonated_by'),
});

export const account = pgTable('account', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    issuer: text('issuer'),
    userId: text('user_id')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        agentId: text('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (table) => [index('conversations_user_id_idx').on(table.userId), index('conversations_agent_id_idx').on(table.agentId)],
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
    user: one(user, { fields: [conversations.userId], references: [user.id] }),
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
// MEMBERSHIP PLANS & ORDERS & BILLING
// ==========================================
export const membershipPlans = pgTable('membership_plans', {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    chatQuotaPerDay: integer('chat_quota_per_day'),
    monthlyPriceCents: integer('monthly_price_cents').notNull().default(0),
    yearlyPriceCents: integer('yearly_price_cents'),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const orders = pgTable(
    'orders',
    {
        id: text('id').primaryKey(),
        orderNo: text('order_no').notNull().unique(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        planId: text('plan_id')
            .notNull()
            .references(() => membershipPlans.id, { onDelete: 'restrict' }),
        planCode: text('plan_code').notNull(),
        period: text('period').notNull().default('monthly'), // 'monthly' | 'yearly'
        amountCents: integer('amount_cents').notNull(),
        status: text('status').notNull().default('pending'), // 'pending' | 'paid' | 'closed' | 'refunded'
        provider: text('provider').notNull().default('wechat'), // 'wechat' | 'mock'
        providerTradeNo: text('provider_trade_no'),
        payInfo: jsonb('pay_info').$type<Record<string, unknown>>(),
        paidAt: timestamp('paid_at'),
        closedAt: timestamp('closed_at'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [index('orders_user_id_idx').on(t.userId), index('orders_status_idx').on(t.status)],
);

export const userMemberships = pgTable(
    'user_memberships',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        planId: text('plan_id')
            .notNull()
            .references(() => membershipPlans.id, { onDelete: 'restrict' }),
        planCode: text('plan_code').notNull(),
        status: text('status').notNull().default('active'), // 'active' | 'expired'
        startsAt: timestamp('starts_at').notNull().defaultNow(),
        expiresAt: timestamp('expires_at').notNull(),
        orderId: text('order_id').references(() => orders.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [index('user_memberships_user_id_idx').on(t.userId), uniqueIndex('user_memberships_order_id_idx').on(t.orderId)],
);

export const usageCounters = pgTable(
    'usage_counters',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        periodKey: text('period_key').notNull(),
        count: integer('count').notNull().default(0),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [uniqueIndex('usage_counters_user_period_idx').on(t.userId, t.periodKey)],
);

export const membershipPlansRelations = relations(membershipPlans, ({ many }) => ({
    orders: many(orders),
    memberships: many(userMemberships),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
    user: one(user, { fields: [orders.userId], references: [user.id] }),
    plan: one(membershipPlans, { fields: [orders.planId], references: [membershipPlans.id] }),
}));

export const userMembershipsRelations = relations(userMemberships, ({ one }) => ({
    user: one(user, { fields: [userMemberships.userId], references: [user.id] }),
    plan: one(membershipPlans, { fields: [userMemberships.planId], references: [membershipPlans.id] }),
    order: one(orders, { fields: [userMemberships.orderId], references: [orders.id] }),
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
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
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
    (t) => [index('attachments_user_id_idx').on(t.userId), index('attachments_created_at_idx').on(t.createdAt)],
);

// ==========================================
// 资讯新闻
// ==========================================
export const news = pgTable(
    'news',
    {
        id: text('id').primaryKey(),
        title: text('title').notNull(),
        summary: text('summary').notNull().default(''),
        // Markdown 正文，两端用同一套渲染
        content: text('content').notNull().default(''),
        coverImage: text('cover_image').notNull().default(''),
        category: text('category').notNull().default('general'),
        tags: jsonb('tags').$type<string[]>().notNull().default([]),
        status: text('status').notNull().default('draft'), // draft | published
        pinned: boolean('pinned').notNull().default(false),
        viewCount: integer('view_count').notNull().default(0),
        authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
        publishedAt: timestamp('published_at'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [index('news_status_published_idx').on(t.status, t.publishedAt), index('news_category_idx').on(t.category)],
);

// ==========================================
// 宣传栏（运营位 / 公告横幅）
// ==========================================
export const bulletins = pgTable(
    'bulletins',
    {
        id: text('id').primaryKey(),
        title: text('title').notNull(),
        content: text('content').notNull().default(''),
        imageUrl: text('image_url').notNull().default(''),
        linkUrl: text('link_url').notNull().default(''),
        linkText: text('link_text').notNull().default(''),
        // 展示位置：home 首页 / chat 对话页 / global 全站
        position: text('position').notNull().default('home'),
        level: text('level').notNull().default('info'), // info | success | warning | danger
        enabled: boolean('enabled').notNull().default(true),
        sortOrder: integer('sort_order').notNull().default(0),
        // 投放时间窗，留空表示长期有效
        startsAt: timestamp('starts_at'),
        endsAt: timestamp('ends_at'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [index('bulletins_position_enabled_idx').on(t.position, t.enabled)],
);

// ==========================================
// 消息通知
// ==========================================
// audience = all 时对所有用户可见（含未来注册用户），不写入 recipients；
// audience = users 时按 targetUsers 展开为收件人记录。已读状态统一存 recipients。
export const notifications = pgTable(
    'notifications',
    {
        id: text('id').primaryKey(),
        title: text('title').notNull(),
        content: text('content').notNull().default(''),
        type: text('type').notNull().default('system'), // system | announcement | activity | billing
        level: text('level').notNull().default('info'), // info | success | warning | danger
        audience: text('audience').notNull().default('all'), // all | users
        linkUrl: text('link_url').notNull().default(''),
        createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (t) => [index('notifications_created_at_idx').on(t.createdAt)],
);

export const notificationRecipients = pgTable(
    'notification_recipients',
    {
        id: text('id').primaryKey(),
        notificationId: text('notification_id')
            .notNull()
            .references(() => notifications.id, { onDelete: 'cascade' }),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        readAt: timestamp('read_at'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (t) => [uniqueIndex('notification_recipients_unique_idx').on(t.notificationId, t.userId), index('notification_recipients_user_idx').on(t.userId)],
);

// ==========================================
// INFERRED TYPES
// ==========================================
export type User = typeof user.$inferSelect;
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
export type MembershipPlan = typeof membershipPlans.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type UserMembership = typeof userMemberships.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;
export type StorageConfig = typeof storageConfigs.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type News = typeof news.$inferSelect;
export type Bulletin = typeof bulletins.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NotificationRecipient = typeof notificationRecipients.$inferSelect;
