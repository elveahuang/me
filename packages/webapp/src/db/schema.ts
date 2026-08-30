import { relations } from 'drizzle-orm';
import {
    bigserial,
    boolean,
    index,
    integer,
    jsonb,
    pgTable,
    primaryKey,
    serial,
    text,
    timestamp,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Better Auth core tables (see https://better-auth.com/docs/concepts/database)
// plus the `admin` plugin fields on user/session.
// ---------------------------------------------------------------------------

export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    // admin plugin fields
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
    // admin plugin fields
    impersonatedBy: text('impersonated_by'),
});

export const account = pgTable('account', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    // better-auth 1.7 必填：账号颁发方标识（本地密码登录为合成 issuer）
    issuer: text('issuer').notNull(),
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

// ---------------------------------------------------------------------------
// Agents & Skills
// ---------------------------------------------------------------------------

export const agents = pgTable('agents', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    emoji: text('emoji').notNull().default('🤖'),
    description: text('description').notNull().default(''),
    systemPrompt: text('system_prompt').notNull().default(''),
    // e.g. "deepseek:deepseek-chat" | "openai:gpt-4o-mini"；providerId 非空时优先用自定义供应商
    model: text('model').notNull().default('deepseek:deepseek-chat'),
    // 自定义供应商（ai_providers.id）；为空表示使用内置环境变量型供应商
    providerId: integer('provider_id').references(() => aiProviders.id, { onDelete: 'set null' }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const skills = pgTable('skills', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    instructions: text('instructions').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const agentSkills = pgTable(
    'agent_skills',
    {
        agentId: integer('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        skillId: integer('skill_id')
            .notNull()
            .references(() => skills.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.agentId, t.skillId] })],
);

// ---------------------------------------------------------------------------
// Conversations & messages
// ---------------------------------------------------------------------------

export const conversations = pgTable(
    'conversations',
    {
        id: serial('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        agentId: integer('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        title: text('title').notNull().default('新对话'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [index('conversations_user_id_idx').on(t.userId), index('conversations_agent_id_idx').on(t.agentId)],
);

/** A single chat message; `id` is the AI SDK UIMessage id, parts follow the UIMessage parts format. */
export const messages = pgTable(
    'messages',
    {
        id: text('id').primaryKey(),
        // 全局递增序列，用于会话内消息的稳定排序
        seq: bigserial('seq', { mode: 'number' }).notNull(),
        conversationId: integer('conversation_id')
            .notNull()
            .references(() => conversations.id, { onDelete: 'cascade' }),
        role: text('role').notNull(),
        parts: jsonb('parts').notNull(),
        createdAt: timestamp('created_at').notNull().defaultNow(),
    },
    (t) => [index('messages_conversation_id_idx').on(t.conversationId)],
);

// ---------------------------------------------------------------------------
// AI 供应商 / Tools / 知识库
// ---------------------------------------------------------------------------

/** 自定义 AI 供应商（OpenAI 兼容协议：DeepSeek/Moonshot/Ollama/OpenRouter 等） */
export const aiProviders = pgTable('ai_providers', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    // openai-compatible | deepseek（目前两种协议，deepseek 也兼容 openai 协议）
    protocol: text('protocol').notNull().default('openai-compatible'),
    baseUrl: text('base_url').notNull(),
    apiKey: text('api_key').notNull().default(''),
    // 可选：该供应商的 embedding 模型（供知识库向量化使用），为空表示不支持
    embeddingModel: text('embedding_model'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** 可配置工具：内置工具或 HTTP 工具（AI SDK tool calling） */
export const tools = pgTable('tools', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    // builtin_time（内置：查询当前时间） | http（调用自定义 HTTP 端点）
    type: text('type').notNull().default('builtin_time'),
    // http 工具配置：{ url, method, headers, bodyTemplate, parameters: [{name,type,description,required}] }
    config: jsonb('config').notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const agentTools = pgTable(
    'agent_tools',
    {
        agentId: integer('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        toolId: integer('tool_id')
            .notNull()
            .references(() => tools.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.agentId, t.toolId] })],
);

/** MCP 服务器（Model Context Protocol）：挂载到智能体后其工具在对话中可用 */
export const mcpServers = pgTable('mcp_servers', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    // http（Streamable HTTP）| sse（旧版 SSE）| stdio（本地进程）
    transport: text('transport').notNull().default('http'),
    url: text('url'),
    command: text('command'),
    args: jsonb('args'),
    env: jsonb('env'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const agentMcpServers = pgTable(
    'agent_mcp_servers',
    {
        agentId: integer('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        mcpServerId: integer('mcp_server_id')
            .notNull()
            .references(() => mcpServers.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.agentId, t.mcpServerId] })],
);

/** 知识库 */
export const knowledgeBases = pgTable('knowledge_bases', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    // 向量化供应商（ai_providers.id）；为空则检索时退化为关键词匹配
    embeddingProviderId: integer('embedding_provider_id').references(() => aiProviders.id, {
        onDelete: 'set null',
    }),
    embeddingModel: text('embedding_model'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const knowledgeDocuments = pgTable(
    'knowledge_documents',
    {
        id: serial('id').primaryKey(),
        kbId: integer('kb_id')
            .notNull()
            .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
        title: text('title').notNull(),
        content: text('content').notNull(),
        chunkCount: integer('chunk_count').notNull().default(0),
        // ready | embedded（完成向量化）
        status: text('status').notNull().default('ready'),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (t) => [index('knowledge_documents_kb_id_idx').on(t.kbId)],
);

export const knowledgeChunks = pgTable(
    'knowledge_chunks',
    {
        id: serial('id').primaryKey(),
        documentId: integer('document_id')
            .notNull()
            .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
        kbId: integer('kb_id')
            .notNull()
            .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
        seq: integer('seq').notNull().default(0),
        content: text('content').notNull(),
        // float[] 序列化存储；null 表示未向量化（检索退化为关键词匹配）
        embedding: jsonb('embedding'),
        embeddingModel: text('embedding_model'),
    },
    (t) => [index('knowledge_chunks_kb_id_idx').on(t.kbId), index('knowledge_chunks_document_id_idx').on(t.documentId)],
);

export const agentKnowledge = pgTable(
    'agent_knowledge',
    {
        agentId: integer('agent_id')
            .notNull()
            .references(() => agents.id, { onDelete: 'cascade' }),
        kbId: integer('kb_id')
            .notNull()
            .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.agentId, t.kbId] })],
);

// ---------------------------------------------------------------------------
// Relations (for drizzle relational queries if needed)
// ---------------------------------------------------------------------------

export const agentsRelations = relations(agents, ({ many }) => ({
    agentSkills: many(agentSkills),
    agentTools: many(agentTools),
    agentKnowledge: many(agentKnowledge),
    agentMcpServers: many(agentMcpServers),
    conversations: many(conversations),
}));

export const mcpServersRelations = relations(mcpServers, ({ many }) => ({
    agentMcpServers: many(agentMcpServers),
}));

export const agentMcpServersRelations = relations(agentMcpServers, ({ one }) => ({
    agent: one(agents, { fields: [agentMcpServers.agentId], references: [agents.id] }),
    mcpServer: one(mcpServers, { fields: [agentMcpServers.mcpServerId], references: [mcpServers.id] }),
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

export const knowledgeBasesRelations = relations(knowledgeBases, ({ many, one }) => ({
    documents: many(knowledgeDocuments),
    agentKnowledge: many(agentKnowledge),
    embeddingProvider: one(aiProviders, {
        fields: [knowledgeBases.embeddingProviderId],
        references: [aiProviders.id],
    }),
}));

export const knowledgeDocumentsRelations = relations(knowledgeDocuments, ({ one, many }) => ({
    kb: one(knowledgeBases, { fields: [knowledgeDocuments.kbId], references: [knowledgeBases.id] }),
    chunks: many(knowledgeChunks),
}));

export const knowledgeChunksRelations = relations(knowledgeChunks, ({ one }) => ({
    document: one(knowledgeDocuments, {
        fields: [knowledgeChunks.documentId],
        references: [knowledgeDocuments.id],
    }),
    kb: one(knowledgeBases, { fields: [knowledgeChunks.kbId], references: [knowledgeBases.id] }),
}));

export const agentKnowledgeRelations = relations(agentKnowledge, ({ one }) => ({
    agent: one(agents, { fields: [agentKnowledge.agentId], references: [agents.id] }),
    kb: one(knowledgeBases, { fields: [agentKnowledge.kbId], references: [knowledgeBases.id] }),
}));

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
