import { relations } from 'drizzle-orm';
import {
    bigserial,
    boolean,
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
    // e.g. "deepseek:deepseek-chat" | "openai:gpt-4o-mini"
    model: text('model').notNull().default('deepseek:deepseek-chat'),
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

export const conversations = pgTable('conversations', {
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
});

/** A single chat message; `id` is the AI SDK UIMessage id, parts follow the UIMessage parts format. */
export const messages = pgTable('messages', {
    id: text('id').primaryKey(),
    // 全局递增序列，用于会话内消息的稳定排序
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    conversationId: integer('conversation_id')
        .notNull()
        .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    parts: jsonb('parts').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Relations (for drizzle relational queries if needed)
// ---------------------------------------------------------------------------

export const agentsRelations = relations(agents, ({ many }) => ({
    agentSkills: many(agentSkills),
    conversations: many(conversations),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
    agentSkills: many(agentSkills),
}));

export const agentSkillsRelations = relations(agentSkills, ({ one }) => ({
    agent: one(agents, { fields: [agentSkills.agentId], references: [agents.id] }),
    skill: one(skills, { fields: [agentSkills.skillId], references: [skills.id] }),
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
