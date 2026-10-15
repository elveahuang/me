import { and, desc, eq, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { notes } from '../db/schema';
import { db } from './db';
import { bigrams, bigramScore, embedTexts } from './embedding';
import { markdownToPlainText, resolveNoteEmbeddingTarget } from './note-index';
import { likePattern } from './query';

/**
 * 笔记检索：向量优先，退回字面匹配。
 *
 * 与知识库的 RAG 同一套口径（`embedding.ts`），差别在规模与目的：
 * 笔记是「我自己的几百篇」，所以一次把候选捞进内存算余弦是安全的（上限 NOTE_SCAN_MAX），
 * 不需要知识库那套按库均摊的扫描预算；但**维度不可比一律剔除**这条不变量完全一致——
 * 换过嵌入模型后老向量是 1024 维、查询向量是 1536 维，截断公共前缀实测能算出 1.00，
 * 那类片段带着「相关度 1.00」进提示词比搜不到更糟。
 */

/** 一次检索最多扫描多少条笔记：向量存在 JSONB 里、余弦在应用层暴力算，这个数就是 CPU 与内存边界。 */
const NOTE_SCAN_MAX = 1000;
/** 字面打分用的正文长度：标题与摘要已经承担了语义，正文只看开头一段。 */
const KEYWORD_TEXT_MAX = 2_000;
/** 向量命中的最低相关度。低于它宁可回落到字面匹配，也不要给用户一串不相干的笔记。 */
const VECTOR_MIN_SCORE = 0.32;

export interface NoteSearchHit {
    id: string;
    title: string;
    summary: string;
    updatedAt: Date;
    score: number;
    /** 命中方式：界面据此标注「语义/字面」，也把降级暴露出来而不是静默换算法 */
    mode: 'vector' | 'keyword';
    /** 本批因维度不可比被剔除的条数（换过嵌入模型的历史遗留），只挂在首条上 */
    staleVectors?: number;
}

function cosine(a: readonly number[], b: readonly number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        dot += x * y;
        normA += x * x;
        normB += y * y;
    }
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function keywordSearch(querySet: ReadonlySet<string>, lowered: string, limit: number, where: SQL): Promise<NoteSearchHit[]> {
    const rows = await db
        .select({
            id: notes.id,
            title: notes.title,
            summary: notes.summary,
            updatedAt: notes.updatedAt,
            body: sql<string>`left(${notes.content}, ${KEYWORD_TEXT_MAX})`,
        })
        .from(notes)
        .where(where)
        .orderBy(desc(notes.updatedAt))
        .limit(NOTE_SCAN_MAX);

    const scored = rows
        .map((row) => {
            const plain = markdownToPlainText(row.body);
            const textScore = bigramScore(querySet, plain);
            // 标题命中比正文命中重要得多：标题是作者自己写的一句话
            const titleScore = row.title.toLowerCase().includes(lowered) ? 1 : bigramScore(querySet, row.title);
            const summaryScore = row.summary ? bigramScore(querySet, row.summary) : 0;
            const score = Math.max(titleScore, summaryScore * 0.9, textScore);
            return {
                id: row.id,
                title: row.title,
                summary: row.summary || plain.slice(0, 120),
                updatedAt: row.updatedAt,
                score,
                mode: 'keyword' as const,
            };
        })
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || b.updatedAt.getTime() - a.updatedAt.getTime());

    return scored.slice(0, limit);
}

/**
 * 检索笔记。`projectId` 传值表示限定某个项目，不传表示全库。
 *
 * 向量路径的任何一次失败（供应商未配、外呼超时、候选维度全不可比）都落到字面匹配，
 * 并把原因写进日志：用户点「搜索」要得到结果，而不是一个 502。
 */
export async function searchNotes(query: string, options: { limit?: number; projectId?: string | null } = {}): Promise<NoteSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 10) || 10, 1), 50);
    const pattern = likePattern(trimmed);

    const target = await resolveNoteEmbeddingTarget();
    if (target) {
        try {
            const [queryVector] = await embedTexts(target.provider, target.model, [trimmed]);
            if (Array.isArray(queryVector) && queryVector.length) {
                const candidates = await db
                    .select({
                        id: notes.id,
                        title: notes.title,
                        summary: notes.summary,
                        updatedAt: notes.updatedAt,
                        embedding: notes.embedding,
                    })
                    .from(notes)
                    .where(and(isNotNull(notes.embedding), options.projectId ? eq(notes.projectId, options.projectId) : undefined))
                    .orderBy(desc(notes.updatedAt))
                    .limit(NOTE_SCAN_MAX);

                let stale = 0;
                const hits: NoteSearchHit[] = [];
                for (const row of candidates) {
                    const vector = row.embedding;
                    if (!Array.isArray(vector) || !vector.length) continue;
                    if (vector.length !== queryVector.length) {
                        stale++;
                        continue;
                    }
                    const score = cosine(vector, queryVector);
                    if (score < VECTOR_MIN_SCORE) continue;
                    hits.push({ id: row.id, title: row.title, summary: row.summary, updatedAt: row.updatedAt, score, mode: 'vector' });
                }
                if (stale) {
                    console.warn(
                        `[note-search] ${stale} 条笔记的向量与 ${target.model} 的 ${queryVector.length} 维不可比，已剔除；请到「设置 → 笔记索引」重建索引。`,
                    );
                }
                hits.sort((a, b) => b.score - a.score);
                const top = hits.slice(0, limit);
                // 向量命中为空时继续走字面匹配：语义检索不该因为「没有相似向量」就返回零结果
                if (top.length) {
                    top[0] = { ...top[0]!, staleVectors: stale };
                    return top;
                }
            }
        } catch (error) {
            console.error('[note-search] 语义检索失败，退回字面匹配:', error);
        }
    }

    const filters: SQL[] = [or(ilike(notes.title, pattern), ilike(notes.summary, pattern), ilike(notes.content, pattern))!];
    if (options.projectId) filters.push(eq(notes.projectId, options.projectId));
    // bigrams(query) 只在循环外算一次：下面每个候选行都要打一次分，
    // 让 bigramScore 自己重算会把整段兜底变成 O(查询长度 × 笔记数)（见 embedding.ts 的 bigramScore 注释）。
    return keywordSearch(bigrams(trimmed), trimmed.toLowerCase(), limit, and(...filters)!);
}
