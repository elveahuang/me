import { eq } from 'drizzle-orm';
import { notes } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { db } from '../../utils/db';
import { requireMethod } from '../../utils/method';
import { scheduleNoteIndex } from '../../utils/note-index';
import { noteColumns } from '../../utils/note-select';
import { capBody } from '../../utils/request-body';
import { routeId } from '../../utils/route-id';
import { NOTE_CONTENT_MAX, WORK_TITLE_MAX, normalizeNoteKind, normalizeWorkOptionalText, normalizeWorkTags } from '../../utils/work-input';
import { assertProjectExists, lockProjectRow } from '../../utils/work-project';

const NOTE_BODY_LIMIT_BYTES = 1024 * 1024;

export default defineEventHandler(async (event) => {
    await capBody(event, NOTE_BODY_LIMIT_BYTES);
    const method = requireMethod(event, ['GET', 'PATCH', 'DELETE']);
    const id = routeId(event, 'id', '笔记');

    if (method === 'DELETE') {
        const deleted = await db.delete(notes).where(eq(notes.id, id)).returning({ id: notes.id });
        if (!deleted.length) throw createError({ statusCode: 404, statusMessage: '笔记不存在' });
        return { ok: true };
    }

    if (method === 'GET') {
        const [row] = await db.select(noteColumns).from(notes).where(eq(notes.id, id));
        if (!row) throw createError({ statusCode: 404, statusMessage: '笔记不存在' });
        return row;
    }

    const body = (await readBody(event)) ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = normalizeWorkOptionalText(body.title, 'title', WORK_TITLE_MAX);
    if (body.content !== undefined) patch.content = normalizeWorkOptionalText(body.content, 'content', NOTE_CONTENT_MAX);
    if (body.kind !== undefined) patch.kind = normalizeNoteKind(body.kind);
    if (body.pinned !== undefined) patch.pinned = normalizeAdminBoolean(body.pinned, 'pinned', false);
    if (body.tags !== undefined) patch.tags = normalizeWorkTags(body.tags);
    if (body.projectId !== undefined) patch.projectId = await assertProjectExists(body.projectId);

    // 改了正文就要让旧索引失效：summary 是给检索回喂用的，留着旧值等于拿过期结论回答新问题。
    // 清空之后立刻补一次异步索引（摘要 + 向量），否则这条笔记在用户下一次点开「重建索引」之前
    // 既搜不到语义、列表里也没有摘要。
    if (body.content !== undefined) {
        patch.summary = '';
        patch.embedding = null;
        patch.embeddingModel = null;
        patch.embeddingDim = null;
    }

    const [row] = await db.transaction(async (tx) => {
        // 与新建同一口径：锁父项目与写笔记同事务，并发删除项目时得到 400 而不是 23503 → 500
        if (patch.projectId !== undefined) await lockProjectRow(tx, patch.projectId as string | null);
        return tx.update(notes).set(patch).where(eq(notes.id, id)).returning(noteColumns);
    });
    if (!row) throw createError({ statusCode: 404, statusMessage: '笔记不存在' });
    if (body.content !== undefined) scheduleNoteIndex(id);
    return row;
});
