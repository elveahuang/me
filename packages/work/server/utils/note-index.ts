import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { notes, type Note, type Provider } from '../db/schema';
import { db } from './db';
import { embedTexts } from './embedding';
import { getEnabledProviders } from './providers';

/**
 * 笔记的检索索引：摘要 + 向量。
 *
 * 为什么放在保存之后异步做，而不是在 `/api/notes` 的写事务里同步算：
 * 1. 嵌入是一次真实外呼（供应商停摆时最长 30 秒），把它塞进保存事务会让「用户敲下回车」变成一次
 *    可能失败的请求——正文已经丢了才是真事故，索引迟到不是。
 * 2. 向量失败只影响语义检索的召回，`/api/notes/search` 有 Bigram 兜底，所以降级路径本就存在。
 *
 * 索引状态刻意**不**落进 `notes.status` 这类新列（会需要迁移）：
 * `embedding is null` 就是「未索引」，`summary` 为空就是「摘要待生成」，
 * Today 与设置页据此显示「有 N 条未索引」，重建走 `POST /api/notes/reindex`。
 */

/** 摘要长度：够回喂上下文与列表展示，又不至于把正文整段搬进提示词。 */
export const NOTE_SUMMARY_MAX = 200;
/** 送进嵌入模型的正文长度：向量表达的是「这篇讲什么」，不是全文检索。 */
const NOTE_EMBED_INPUT_MAX = 2_000;
/** 一次批量重建最多处理多少条，避免把 Nitro 进程长时间占在循环里。 */
export const NOTE_INDEX_BATCH_MAX = 50;

/**
 * Markdown → 纯文本（摘要用）。
 *
 * 只服务「读起来像一句话」，不做完整 CommonMark：代码围栏整段丢掉（里面是符号不是语义），
 * 行内标记与链接语法摘掉、保留链接文字，标题与列表符号去掉。
 */
export function markdownToPlainText(markdown: string): string {
    const withoutFences = markdown.replace(/```[\s\S]*?```/g, ' ');
    const withoutInline = withoutFences
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*[-+*]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/\|/g, ' ')
        .replace(/<[^>]+>/g, ' ');
    return withoutInline.replace(/\s+/g, ' ').trim();
}

/** 从正文取一句可读摘要；正文为空时回退标题（否则列表里两栏都是空的）。 */
export function deriveNoteSummary(content: string, title = ''): string {
    const plain = markdownToPlainText(content);
    const base = plain || title.trim();
    if (!base) return '';
    return base.length <= NOTE_SUMMARY_MAX ? base : `${base.slice(0, NOTE_SUMMARY_MAX)}…`;
}

/** 笔记用哪个嵌入模型；`null` 表示本机没配可用的嵌入模型，索引退化为「只写摘要」。 */
export type NoteEmbeddingTarget = { provider: Provider; model: string } | null;

/**
 * 笔记用哪个嵌入模型。
 *
 * 与知识库不同，笔记没有「用户为库选的模型」这一层配置，因此取默认供应商 models 里名字像
 * embedding 的那一个；一个都没有时返回 null，调用方据此**跳过向量**（摘要仍然写），
 * 检索自然落到 Bigram 兜底而不是报错——工作台不该因为没配嵌入模型就存不了笔记。
 */
export async function resolveNoteEmbeddingTarget(): Promise<NoteEmbeddingTarget> {
    const enabled = await getEnabledProviders();
    const withKey = enabled.filter((p) => p.apiKey);
    const provider = withKey.find((p) => p.isDefault) ?? withKey[0];
    if (!provider) return null;
    const model = provider.models.find((m) => /embed/i.test(m));
    return model ? { provider, model } : null;
}

/** 参与向量化的输入：标题 + 正文前段，同一篇的重建与查询必须用同一份拼装规则。 */
function noteEmbedInput(note: Pick<Note, 'title' | 'content'>): string {
    const body = note.content.slice(0, NOTE_EMBED_INPUT_MAX);
    return note.title ? `${note.title}\n${body}` : body;
}

/**
 * 索引单条笔记：写摘要，并在配了嵌入模型时补向量。
 *
 * 返回 false 表示这条已经没有可索引的内容（正文为空且摘要已定），调用方不必计数。
 */
export async function indexNote(id: string, target?: NoteEmbeddingTarget): Promise<boolean> {
    const [note] = await db.select().from(notes).where(eq(notes.id, id));
    if (!note) return false;

    const patch: Record<string, unknown> = {};
    const summary = deriveNoteSummary(note.content, note.title);
    if (summary !== note.summary) patch.summary = summary;

    const embedTarget = target === undefined ? await resolveNoteEmbeddingTarget() : target;
    if (embedTarget && note.content.trim()) {
        const [vector] = await embedTexts(embedTarget.provider, embedTarget.model, [noteEmbedInput(note)]);
        if (Array.isArray(vector) && vector.length) {
            patch.embedding = vector;
            patch.embeddingModel = embedTarget.model;
            patch.embeddingDim = vector.length;
        }
    }

    if (!Object.keys(patch).length) return false;
    await db.update(notes).set(patch).where(eq(notes.id, id));
    return true;
}

/**
 * 保存后的异步索引入口：失败只记日志。
 *
 * 不能让它变成 unhandledRejection——`server/plugins/error-guard.ts` 会把未处理 rejection 变成
 * `process.exit(1)`，一次嵌入失败会带走整个工作台的所有在途请求，所以这里自己 catch。
 */
export function scheduleNoteIndex(id: string): void {
    void indexNote(id).catch((error) => {
        console.error(`[note-index] 笔记 ${id} 索引失败:`, error);
    });
}

/**
 * 「还没索引好」的判据，随是否配了嵌入模型而变。
 *
 * 不能无条件把 `embedding is null` 算作未索引：没配嵌入模型时它永远为真，
 * 设置页会常驻「有 N 条未索引」、点「重建索引」也永远归不了零——
 * 而对用户来说那其实是「已按可用的方式索引好了」。
 */
function pendingWhere(target: NoteEmbeddingTarget | null) {
    const missingSummary = sql`${notes.summary} = ''`;
    return target ? or(isNull(notes.embedding), missingSummary) : missingSummary;
}

/** 未索引（缺摘要，或配了嵌入模型时缺向量）的笔记条数，供设置页与 Today 页提示。 */
export async function countUnindexedNotes(): Promise<number> {
    const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notes)
        .where(pendingWhere(await resolveNoteEmbeddingTarget()));
    return Number(row?.count ?? 0);
}

/**
 * 批量补索引：优先最近改动的笔记。
 *
 * 只处理「按当前配置还缺东西」的行，所以重复调用是幂等的增量补齐，
 * 设置页的「重建笔记索引」按钮可以放心连点（外层另有 `gateExpensiveCalls`）。
 */
export async function indexPendingNotes(limit = NOTE_INDEX_BATCH_MAX): Promise<{ indexed: number; scanned: number; skipped: number }> {
    const target = await resolveNoteEmbeddingTarget();
    const rows = await db
        .select({ id: notes.id })
        .from(notes)
        .where(and(sql`${notes.content} <> ''`, pendingWhere(target)))
        .orderBy(sql`${notes.updatedAt} desc`)
        .limit(Math.min(Math.max(Math.floor(limit) || 1, 1), NOTE_INDEX_BATCH_MAX));

    let indexed = 0;
    let skipped = 0;
    for (const row of rows) {
        try {
            if (await indexNote(row.id, target)) indexed++;
            else skipped++;
        } catch (error) {
            skipped++;
            console.error(`[note-index] 批量索引失败（${row.id}），该条跳过:`, error);
        }
    }
    return { indexed, scanned: rows.length, skipped };
}
