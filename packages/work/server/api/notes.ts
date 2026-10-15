import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { notes } from '../db/schema';
import { normalizeAdminBoolean } from '../utils/admin-boolean';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { scheduleNoteIndex } from '../utils/note-index';
import { noteColumns } from '../utils/note-select';
import { LOCAL_OWNER } from '../utils/owner';
import { intParam, likePattern, stringParam } from '../utils/query';
import { rateLimit } from '../utils/rate-limit';
import { capBody } from '../utils/request-body';
import { NOTE_CONTENT_MAX, WORK_TAG_MAX, WORK_TITLE_MAX, normalizeNoteKind, normalizeWorkOptionalText, normalizeWorkTags } from '../utils/work-input';
import { assertProjectExists, lockProjectRow } from '../utils/work-project';

const NOTE_LIST_MAX = 200;

/**
 * 笔记正文上限对应的请求体闸门：`WORK_TAG_MAX` 级别字段撑不出大 body，
 * 但一篇 20 万汉字的笔记按 UTF-8 是 600KB，公共的 256KB 会把合法保存拦成 413。
 */
const NOTE_BODY_LIMIT_BYTES = 1024 * 1024;

export default defineEventHandler(async (event) => {
    await capBody(event, NOTE_BODY_LIMIT_BYTES);
    const method = requireMethod(event, ['GET', 'POST']);
    const query = getQuery(event);

    if (method === 'POST') {
        const limited = await rateLimit(`note-create:${LOCAL_OWNER}`, 60, 60_000);
        if (!limited.ok) throw createError({ statusCode: 429, statusMessage: `创建过于频繁，请 ${limited.retryAfterSec} 秒后再试` });

        const body = (await readBody(event)) ?? {};
        const id = crypto.randomUUID();
        const projectId = await assertProjectExists(body.projectId);
        const title = normalizeWorkOptionalText(body.title, 'title', WORK_TITLE_MAX);
        const content = normalizeWorkOptionalText(body.content, 'content', NOTE_CONTENT_MAX);
        // 只带 content 或只带 title 都算一条笔记，两者都空则不是内容：
        // 无请求体时 `readBody` 给 undefined，取不到任何字段就归一成一条空笔记并回 200 + 新 id——
        // 客户端（尤其是把正文发丢的脚本与写错 content-type 的调用方）以为存下来了，实际只留下一行垃圾。
        if (!title && !content) {
            throw createError({ statusCode: 400, statusMessage: 'title 与 content 至少填写一项' });
        }
        await db.transaction(async (tx) => {
            await lockProjectRow(tx, projectId);
            await tx.insert(notes).values({
                id,
                projectId,
                title,
                content,
                kind: normalizeNoteKind(body.kind),
                pinned: normalizeAdminBoolean(body.pinned, 'pinned', false),
                tags: normalizeWorkTags(body.tags),
            });
        });
        // 先把回给客户端的那一行读完，再触发异步索引：
        // 反过来的话索引那次 `update(summary)` 可能与这里的 SELECT 交错，
        // 同一次保存有时带摘要有时不带，界面列表就会闪一下「空摘要」。
        const [row] = await db.select(noteColumns).from(notes).where(eq(notes.id, id));
        // 正文异步索引（摘要 + 向量）：放在响应之前触发、但不 await——
        // 一次嵌入外呼不该挡在用户按下「保存」与看到列表之间。
        scheduleNoteIndex(id);
        return row;
    }

    const where: SQL[] = [];
    const kind = stringParam(query.kind);
    if (kind) {
        const list = kind
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s === 'note' || s === 'daily');
        if (list.length) where.push(inArray(notes.kind, list as ('note' | 'daily')[]));
    }

    const projectId = stringParam(query.projectId);
    if (projectId) where.push(eq(notes.projectId, projectId));
    if (stringParam(query.pinned) === '1') where.push(eq(notes.pinned, true));

    const tag = stringParam(query.tag, WORK_TAG_MAX);
    if (tag) {
        // tags 是 jsonb 字符串数组，用 @> 走包含判断而不是把整表拉回内存 filter
        where.push(sql`${notes.tags} @> ${JSON.stringify([tag])}::jsonb`);
    }

    // 关键词命中标题或正文任一即可；正文是大字段，ilike '%x%' 用不上索引，
    // 所以列表默认只取 200 条封顶，检索页另说。
    const keyword = stringParam(query.keyword);
    if (keyword) {
        const pattern = likePattern(keyword);
        where.push(or(ilike(notes.title, pattern), ilike(notes.content, pattern))!);
    }

    const limit = intParam(query.limit, NOTE_LIST_MAX, 1, NOTE_LIST_MAX);
    // 摘要列表不带正文：笔记正文可达数百 KB，整列表返回会把一次刷新变成几 MB 传输。
    // ?full=1 才回正文（单篇阅读走 GET /api/notes/[id]）。
    if (stringParam(query.full) === '1') {
        return db
            .select(noteColumns)
            .from(notes)
            .where(where.length ? and(...where) : undefined)
            .orderBy(desc(notes.pinned), desc(notes.updatedAt))
            .limit(limit);
    }
    return db
        .select({
            id: notes.id,
            projectId: notes.projectId,
            title: notes.title,
            kind: notes.kind,
            pinned: notes.pinned,
            tags: notes.tags,
            summary: notes.summary,
            createdAt: notes.createdAt,
            updatedAt: notes.updatedAt,
            excerpt: sql<string>`left(${notes.content}, 240)`,
        })
        .from(notes)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(notes.pinned), desc(notes.updatedAt))
        .limit(limit);
});
