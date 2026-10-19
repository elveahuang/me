import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { agents, attachments, conversations, kbDocuments, knowledgeBases, messages, schedules, spaces } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { likePattern, stringParam } from '../utils/query';
import { capBody } from '../utils/request-body';

const GROUP_LIMIT = 6;

/**
 * 全站只读搜索：会话、消息、自动化、空间、附件与知识库。
 *
 * 单主本机应用不需要分词服务；ILIKE 足够覆盖几十到几千条数据。消息正文存在 jsonb 里，
 * 这里用 `parts::text` 做包含匹配，片段取第一个 text part，避免把整段 JSON 回给界面。
 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);
    const q = stringParam(getQuery(event).q, 128)?.trim() ?? '';
    if (!q) {
        return {
            query: '',
            conversations: [],
            messages: [],
            schedules: [],
            spaces: [],
            attachments: [],
            knowledgeBases: [],
            kbDocuments: [],
        };
    }

    const pattern = likePattern(q);
    const [conversationRows, messageRows, scheduleRows, spaceRows, attachmentRows, kbRows, kbDocRows] = await Promise.all([
        db
            .select({
                id: conversations.id,
                title: conversations.title,
                agentId: conversations.agentId,
                agentName: agents.name,
                spaceName: spaces.name,
                updatedAt: conversations.updatedAt,
            })
            .from(conversations)
            .innerJoin(agents, eq(agents.id, conversations.agentId))
            .leftJoin(spaces, eq(spaces.id, conversations.spaceId))
            .where(ilike(conversations.title, pattern))
            .orderBy(desc(conversations.updatedAt))
            .limit(GROUP_LIMIT),
        db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                conversationTitle: conversations.title,
                agentId: conversations.agentId,
                agentName: agents.name,
                spaceName: spaces.name,
                role: messages.role,
                snippet: sql<string>`left(coalesce(nullif(${messages.contentText}, ''), ${messages.parts}->0->>'text'), 180)`,
                createdAt: messages.createdAt,
            })
            .from(messages)
            .innerJoin(conversations, eq(conversations.id, messages.conversationId))
            .innerJoin(agents, eq(agents.id, conversations.agentId))
            .leftJoin(spaces, eq(spaces.id, conversations.spaceId))
            .where(ilike(messages.contentText, pattern))
            .orderBy(desc(messages.seq))
            .limit(GROUP_LIMIT),
        db
            .select({
                id: schedules.id,
                title: schedules.title,
                prompt: sql<string>`left(${schedules.prompt}, 160)`,
                agentId: schedules.agentId,
                agentName: agents.name,
                spaceName: spaces.name,
                enabled: schedules.enabled,
                nextRunAt: schedules.nextRunAt,
            })
            .from(schedules)
            .leftJoin(agents, eq(agents.id, schedules.agentId))
            .leftJoin(spaces, eq(spaces.id, schedules.spaceId))
            .where(or(ilike(schedules.title, pattern), ilike(schedules.prompt, pattern)))
            .orderBy(desc(schedules.enabled), schedules.nextRunAt)
            .limit(GROUP_LIMIT),
        db
            .select({
                id: spaces.id,
                name: spaces.name,
                description: sql<string>`left(${spaces.description}, 160)`,
                icon: spaces.icon,
                updatedAt: spaces.updatedAt,
            })
            .from(spaces)
            .where(and(eq(spaces.archived, false), or(ilike(spaces.name, pattern), ilike(spaces.description, pattern), ilike(spaces.instructions, pattern))))
            .orderBy(desc(spaces.updatedAt))
            .limit(GROUP_LIMIT),
        db
            .select({
                id: attachments.id,
                filename: attachments.filename,
                mimeType: attachments.mimeType,
                size: attachments.size,
                category: attachments.category,
                spaceId: attachments.spaceId,
                createdAt: attachments.createdAt,
            })
            .from(attachments)
            .where(ilike(attachments.filename, pattern))
            .orderBy(desc(attachments.createdAt))
            .limit(GROUP_LIMIT),
        db
            .select({
                id: knowledgeBases.id,
                name: knowledgeBases.name,
                description: sql<string>`left(${knowledgeBases.description}, 160)`,
                embeddingModel: knowledgeBases.embeddingModel,
                updatedAt: knowledgeBases.updatedAt,
            })
            .from(knowledgeBases)
            .where(or(ilike(knowledgeBases.name, pattern), ilike(knowledgeBases.description, pattern)))
            .orderBy(desc(knowledgeBases.updatedAt))
            .limit(GROUP_LIMIT),
        db
            .select({
                id: kbDocuments.id,
                kbId: kbDocuments.kbId,
                kbName: knowledgeBases.name,
                title: kbDocuments.title,
                status: kbDocuments.status,
                chunkCount: kbDocuments.chunkCount,
                createdAt: kbDocuments.createdAt,
            })
            .from(kbDocuments)
            .innerJoin(knowledgeBases, eq(knowledgeBases.id, kbDocuments.kbId))
            .where(ilike(kbDocuments.title, pattern))
            .orderBy(desc(kbDocuments.createdAt))
            .limit(GROUP_LIMIT),
    ]);

    return {
        query: q,
        conversations: conversationRows,
        messages: messageRows,
        schedules: scheduleRows,
        spaces: spaceRows,
        attachments: attachmentRows,
        knowledgeBases: kbRows,
        kbDocuments: kbDocRows,
    };
});
