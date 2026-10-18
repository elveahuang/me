import { eq, sql } from 'drizzle-orm';
import { agents, attachments, conversations, DEFAULT_SPACE_ID, kbDocuments, knowledgeBases, schedules, spaces } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { capBody, readCappedJsonBody } from '../../utils/request-body';
import { routeId } from '../../utils/route-id';
import { ensureDefaultSpace, normalizeSpaceInput } from '../../utils/spaces';

export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'PATCH', 'DELETE']);
    await ensureDefaultSpace();
    const id = routeId(event, 'id', '工作空间');
    const [row] = await db.select().from(spaces).where(eq(spaces.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '工作空间不存在' });

    if (method === 'GET') {
        const [[conv], [sched], [files], [kbs], [docs], defaultAgentRows] = await Promise.all([
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(conversations)
                .where(eq(conversations.spaceId, id)),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(schedules)
                .where(eq(schedules.spaceId, id)),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(attachments)
                .where(eq(attachments.spaceId, id)),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(knowledgeBases)
                .where(eq(knowledgeBases.spaceId, id)),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(kbDocuments)
                .innerJoin(knowledgeBases, eq(knowledgeBases.id, kbDocuments.kbId))
                .where(eq(knowledgeBases.spaceId, id)),
            row.defaultAgentId
                ? db.select({ id: agents.id, name: agents.name, emoji: agents.emoji }).from(agents).where(eq(agents.id, row.defaultAgentId))
                : Promise.resolve([]),
        ]);
        const defaultAgent = defaultAgentRows[0];
        return {
            ...row,
            defaultAgentName: defaultAgent?.name ?? null,
            defaultAgentEmoji: defaultAgent?.emoji ?? null,
            conversationCount: Number(conv?.count ?? 0),
            scheduleCount: Number(sched?.count ?? 0),
            attachmentCount: Number(files?.count ?? 0),
            knowledgeBaseCount: Number(kbs?.count ?? 0),
            documentCount: Number(docs?.count ?? 0),
        };
    }

    if (method === 'PATCH') {
        const body = (await readCappedJsonBody<Record<string, unknown>>(event)) ?? {};
        const input = normalizeSpaceInput(body, {
            name: row.name,
            description: row.description,
            icon: row.icon,
            instructions: row.instructions,
            defaultAgentId: row.defaultAgentId ?? null,
            localRoot: row.localRoot ?? '',
        });
        let defaultAgentName: string | null = null;
        let defaultAgentEmoji: string | null = null;
        if (input.defaultAgentId) {
            const [agentRow] = await db
                .select({ id: agents.id, name: agents.name, emoji: agents.emoji })
                .from(agents)
                .where(eq(agents.id, input.defaultAgentId));
            if (!agentRow) throw createError({ statusCode: 400, statusMessage: '默认智能体不存在' });
            defaultAgentName = agentRow.name;
            defaultAgentEmoji = agentRow.emoji;
        }
        const patch: Record<string, unknown> = { ...input, updatedAt: new Date() };
        if (body.archived !== undefined) {
            const archived = normalizeAdminBoolean(body.archived, 'archived', row.archived);
            if (id === DEFAULT_SPACE_ID && archived) {
                throw createError({ statusCode: 400, statusMessage: '默认空间不能归档' });
            }
            patch.archived = archived;
        }
        const [updated] = await db.update(spaces).set(patch).where(eq(spaces.id, id)).returning();
        return {
            ...updated,
            defaultAgentName,
            defaultAgentEmoji,
        };
    }

    if (id === DEFAULT_SPACE_ID) {
        throw createError({ statusCode: 400, statusMessage: '默认空间不能删除，可以改名或归档' });
    }

    const [[conv], [sched], [files], [kbs]] = await Promise.all([
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(conversations)
            .where(eq(conversations.spaceId, id)),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(schedules)
            .where(eq(schedules.spaceId, id)),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(attachments)
            .where(eq(attachments.spaceId, id)),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(knowledgeBases)
            .where(eq(knowledgeBases.spaceId, id)),
    ]);
    const references = [
        { label: '会话', count: Number(conv?.count ?? 0) },
        { label: '自动化', count: Number(sched?.count ?? 0) },
        { label: '附件', count: Number(files?.count ?? 0) },
        { label: '知识库', count: Number(kbs?.count ?? 0) },
    ].filter((item) => item.count > 0);
    if (references.length) {
        throw createError({
            statusCode: 409,
            statusMessage: `这个空间里还有${references.map((item) => `${item.label} ${item.count}`).join('、')}，请先移走或归档空间`,
        });
    }

    try {
        await db.delete(spaces).where(eq(spaces.id, id));
    } catch (error) {
        console.error('[spaces] 删除工作空间失败:', error);
        throw createError({ statusCode: 409, statusMessage: '这个空间仍被其他数据引用，请先归档空间' });
    }
    return { ok: true };
});
