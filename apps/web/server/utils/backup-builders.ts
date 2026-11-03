import { asc } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
    agentKnowledgeBases,
    agentMcpServers,
    agentSkills,
    agentTools,
    agents,
    approvals,
    artifacts,
    attachments,
    automationRuns,
    conversations,
    goals,
    jobChunks,
    jobs,
    kbDocuments,
    knowledgeBases,
    mcpServers,
    messages,
    providers,
    schedules,
    sessionEvents,
    sessionRuns,
    skills,
    spaces,
    storageConfigs,
    systemSettings,
    todos,
    tools,
} from '../db/schema';
import { db } from './db';

/**
 * 备份导出用的表清单与脱敏口径（JSON 与 NDJSON 两个端点共用）。
 *
 * 新增表时只改这里；漏表仍由冒烟测试第 13 节从 schema 反查 `.from()` 兜底。
 */

/** 密钥字段在导出里一律折成空串，同时把这个决定写进 `redacted`，免得用户以为备份可直接还原 */
export const REDACTED = ['providers.api_key', 'storage_configs.secret_access_key', 'mcp_servers.headers', 'tools.config.headers'];
export const SKIPPED = ['kb_chunks（知识库分块与向量，导入后重新「重建索引」即可）', '附件二进制本体（对象存储的桶需另行备份）'];

/**
 * 把一组请求头折成空对象，但保留头名。
 *
 * 值不能留（`Authorization` 就是凭据本身），名字要留：还原的人得知道这条工具/服务器原先要求填哪几个头。
 * 形状不认识时（不是普通对象）只丢不改，宁可少脱一层也不能把用户的配置写成别的东西。
 */
export function dropHeaderValues(headers: unknown): { headers: Record<string, string>; redactedHeaders: string[] } {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return { headers: {}, redactedHeaders: [] };
    return { headers: {}, redactedHeaders: Object.keys(headers as Record<string, unknown>).sort() };
}

/**
 * 每张表一个 builder：把排序、脱敏和表名写在同一行里。
 *
 * 不用「十几个 await 排成一排再按位置解构」——那种写法加一张表就要数一遍位置，
 * 数错一次不会报错，只会把一张表的内容当成另一张写进备份文件。
 */
export const backupBuilders: Record<string, () => PromiseLike<unknown>> = {
    systemSettings: async () => (await db.select().from(systemSettings))[0] ?? null,
    spaces: () => db.select().from(spaces).orderBy(asc(spaces.createdAt)),
    schedules: () => db.select().from(schedules).orderBy(asc(schedules.createdAt)),
    automationRuns: () => db.select().from(automationRuns).orderBy(asc(automationRuns.startedAt)),
    providers: async () => (await db.select().from(providers).orderBy(asc(providers.name))).map((row) => ({ ...row, apiKey: '' })),
    skills: () => db.select().from(skills).orderBy(asc(skills.name)),
    tools: async () =>
        (await db.select().from(tools).orderBy(asc(tools.name))).map((row) => {
            const config = row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? (row.config as Record<string, unknown>) : null;
            // 只摘 config.headers（HTTP 工具的凭据位），其它键（url / method / bodyTemplate / parameters）是配置不是密钥
            if (!config) return row;
            const { headers, redactedHeaders } = dropHeaderValues(config.headers);
            if (!redactedHeaders.length) return row;
            return { ...row, config: { ...config, headers }, redactedHeaders };
        }),
    mcpServers: async () =>
        (await db.select().from(mcpServers).orderBy(asc(mcpServers.name))).map((row) => {
            const { headers, redactedHeaders } = dropHeaderValues(row.headers);
            return { ...row, headers, redactedHeaders };
        }),
    agents: () => db.select().from(agents).orderBy(asc(agents.name)),
    approvals: () => db.select().from(approvals).orderBy(asc(approvals.createdAt)),
    jobs: () => db.select().from(jobs).orderBy(asc(jobs.createdAt)),
    jobChunks: () => db.select().from(jobChunks).orderBy(asc(jobChunks.jobId), asc(jobChunks.seq)),
    todos: () => db.select().from(todos).orderBy(asc(todos.conversationId)),
    goals: () => db.select().from(goals).orderBy(asc(goals.createdAt)),
    agentSkills: () => db.select().from(agentSkills),
    agentTools: () => db.select().from(agentTools),
    agentMcpServers: () => db.select().from(agentMcpServers),
    agentKnowledgeBases: () => db.select().from(agentKnowledgeBases),
    knowledgeBases: () => db.select().from(knowledgeBases).orderBy(asc(knowledgeBases.name)),
    kbDocuments: () => db.select().from(kbDocuments).orderBy(asc(kbDocuments.createdAt)),
    conversations: () => db.select().from(conversations).orderBy(asc(conversations.createdAt)),
    sessionRuns: () => db.select().from(sessionRuns).orderBy(asc(sessionRuns.startedAt)),
    sessionEvents: () => db.select().from(sessionEvents).orderBy(asc(sessionEvents.conversationId), asc(sessionEvents.seq)),
    messages: () => db.select().from(messages).orderBy(asc(messages.seq)),
    attachments: () => db.select().from(attachments).orderBy(asc(attachments.createdAt)),
    artifacts: () => db.select().from(artifacts).orderBy(asc(artifacts.createdAt)),
    storageConfigs: async () => (await db.select().from(storageConfigs).orderBy(asc(storageConfigs.name))).map((row) => ({ ...row, secretAccessKey: '' })),
};

/**
 * NDJSON 真分页用的表句柄。
 *
 * 与 `backupBuilders` 的键**必须一一对应**（冒烟测试第 13 节会逐键对账）：builder 负责整表导出，
 * 这里只给「按主键游标取一页」的端点用。分开两个映射而不是从 builder 反推，是因为 builder 的闭包里
 * 已经写死了排序/脱敏，拿不到表对象。
 */
export const backupTables: Record<string, PgTable> = {
    systemSettings,
    spaces,
    schedules,
    automationRuns,
    providers,
    skills,
    tools,
    mcpServers,
    agents,
    approvals,
    jobs,
    jobChunks,
    todos,
    goals,
    agentSkills,
    agentTools,
    agentMcpServers,
    agentKnowledgeBases,
    knowledgeBases,
    kbDocuments,
    conversations,
    sessionRuns,
    sessionEvents,
    messages,
    attachments,
    artifacts,
    storageConfigs,
};
