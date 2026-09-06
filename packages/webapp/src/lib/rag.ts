import { db } from '@/db';
import { agentKnowledge, aiProviders, knowledgeBases, knowledgeChunks, knowledgeDocuments } from '@/db/schema';
import { and, cosineDistance, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from './redis';

/** 单块目标长度（字符），中文场景 500-700 比较合适 */
const CHUNK_SIZE = 600;
/** 相邻块的重叠长度 */
const CHUNK_OVERLAP = 80;
/** 单个文档最大字符数（管理端粘贴场景，防超大输入） */
export const MAX_DOCUMENT_CHARS = 200_000;
/** 检索召回的块数 */
const TOP_K = 4;
/** 关键词匹配的最小得分阈值（bigram 重叠率） */
const MIN_BIGRAM_SCORE = 0.08;
/** 向量检索的最小相似度阈值（1 - cosineDistance） */
const MIN_VECTOR_SIMILARITY = 0.25;

/** 按段落 + 长度滑窗切块 */
export function chunkText(content: string): string[] {
    const text = content.replace(/\r\n/g, '\n').trim();
    if (!text) return [];

    const paragraphs = text.split(/\n{2,}/);
    const chunks: string[] = [];
    let buffer = '';

    const flush = () => {
        const trimmed = buffer.trim();
        if (trimmed) chunks.push(trimmed);
        buffer = '';
    };

    for (const paragraph of paragraphs) {
        if ((buffer + '\n\n' + paragraph).length <= CHUNK_SIZE) {
            buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
            continue;
        }
        flush();
        if (paragraph.length <= CHUNK_SIZE) {
            buffer = paragraph;
            continue;
        }
        // 超长段落按滑窗切
        let start = 0;
        while (start < paragraph.length) {
            chunks.push(paragraph.slice(start, start + CHUNK_SIZE).trim());
            start += CHUNK_SIZE - CHUNK_OVERLAP;
        }
    }
    flush();
    return chunks.filter(Boolean);
}

async function requestEmbeddings(baseUrl: string, apiKey: string, model: string, inputs: string[]): Promise<number[][]> {
    const url = `${baseUrl.replace(/\/+$/, '')}/embeddings`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, input: inputs }),
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        throw new Error(`embedding 接口返回 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
    const list = [...(data.data ?? [])].sort((a, b) => a.index - b.index);
    if (list.length !== inputs.length) throw new Error('embedding 接口返回数量与输入不一致');
    return list.map((item) => item.embedding);
}

/** 用供应商的 embedding 接口向量化一批文本（自动按 32 个一批拆分） */
export async function embedTexts(provider: { baseUrl: string; apiKey: string }, model: string, texts: string[]): Promise<number[][]> {
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
        const batch = texts.slice(i, i + 32);
        const embeddings = await requestEmbeddings(provider.baseUrl, provider.apiKey, model, batch);
        result.push(...embeddings);
    }
    return result;
}

/** 中文字符 bigram 集合（无 embedding 时的关键词匹配兜底） */
function bigrams(text: string): Set<string> {
    const normalized = text.toLowerCase().replace(/\s+/g, '');
    const set = new Set<string>();
    for (let i = 0; i < normalized.length - 1; i++) {
        set.add(normalized.slice(i, i + 2));
    }
    return set;
}

function bigramScore(query: string, content: string) {
    const querySet = bigrams(query);
    if (querySet.size === 0) return 0;
    const contentSet = bigrams(content);
    let hits = 0;
    for (const gram of querySet) {
        if (contentSet.has(gram)) hits++;
    }
    return hits / querySet.size;
}

interface RetrievedChunk {
    documentTitle: string;
    content: string;
    score: number;
}

/**
 * 检索：优先采用 pgvector 在数据库层做 HNSW 余弦距离检索；
 * 若未配置 embedding 或向量化失败，自动退化为内存 bigram 关键词匹配。
 * 返回拼接好的参考资料文本（或 null）。
 */
export async function retrieveKnowledge(agentId: number, query: string): Promise<string | null> {
    const bindings = await db.select().from(agentKnowledge).where(eq(agentKnowledge.agentId, agentId));
    if (bindings.length === 0) return null;

    const kbIds = bindings.map((b) => b.kbId);
    const kbRows = await db.select().from(knowledgeBases).where(inArray(knowledgeBases.id, kbIds));
    if (kbRows.length === 0) return null;

    // 文档标题映射
    const docRows = await db
        .select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title })
        .from(knowledgeDocuments)
        .where(inArray(knowledgeDocuments.kbId, kbIds));
    const titleMap = new Map(docRows.map((d) => [d.id, d.title]));

    // 尝试向量检索：需要一个可用的 embedding 供应商
    let queryEmbedding: number[] | null = null;
    const firstKb = kbRows.find((kb) => kb.embeddingProviderId && kb.embeddingModel);
    if (firstKb?.embeddingProviderId && firstKb.embeddingModel) {
        const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, firstKb.embeddingProviderId));
        if (provider?.enabled && provider.baseUrl) {
            const trimmedQuery = query.slice(0, 1000);
            const queryHash = createHash('sha256').update(trimmedQuery).digest('hex');
            const cacheKey = `cache:embed:${firstKb.embeddingProviderId}:${firstKb.embeddingModel}:${queryHash}`;

            // 优先读 Redis 缓存中的 Query Embedding
            queryEmbedding = await cacheGet<number[]>(cacheKey);
            if (!queryEmbedding) {
                try {
                    const [embedding] = await embedTexts({ baseUrl: provider.baseUrl, apiKey: provider.apiKey }, firstKb.embeddingModel, [trimmedQuery]);
                    if (embedding) {
                        queryEmbedding = embedding;
                        // 缓存 1 小时
                        await cacheSet(cacheKey, embedding, 3600);
                    }
                } catch (e) {
                    console.error('[rag] query embedding 失败，退化为关键词匹配:', e);
                }
            }
        }
    }

    // 1. pgvector 原生向量检索
    if (queryEmbedding && queryEmbedding.length > 0) {
        try {
            const similarity = sql<number>`1 - (${cosineDistance(knowledgeChunks.embedding, queryEmbedding)})`;
            const vectorResults = await db
                .select({
                    id: knowledgeChunks.id,
                    documentId: knowledgeChunks.documentId,
                    content: knowledgeChunks.content,
                    similarity,
                })
                .from(knowledgeChunks)
                .where(and(inArray(knowledgeChunks.kbId, kbIds), isNotNull(knowledgeChunks.embedding)))
                .orderBy(cosineDistance(knowledgeChunks.embedding, queryEmbedding))
                .limit(TOP_K);

            const hits = vectorResults.filter((r) => Number(r.similarity) >= MIN_VECTOR_SIMILARITY);
            if (hits.length > 0) {
                return hits
                    .map((chunk, i) => `[${i + 1}]（来源：${titleMap.get(chunk.documentId) ?? '未知文档'}）\n${chunk.content.slice(0, 800)}`)
                    .join('\n\n---\n\n');
            }
        } catch (e) {
            console.warn('[rag] pgvector 检索异常，退化为关键词匹配:', (e as Error)?.message || e);
        }
    }

    // 2. 降级：关键词匹配
    const chunkRows = await db.select().from(knowledgeChunks).where(inArray(knowledgeChunks.kbId, kbIds)).limit(2000);
    if (chunkRows.length === 0) return null;

    const scored: RetrievedChunk[] = [];
    for (const chunk of chunkRows) {
        const score = bigramScore(query, chunk.content);
        if (score > MIN_BIGRAM_SCORE) {
            scored.push({
                documentTitle: titleMap.get(chunk.documentId) ?? '未知文档',
                content: chunk.content.slice(0, 800),
                score,
            });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, TOP_K);
    if (top.length === 0) return null;

    return top.map((chunk, i) => `[${i + 1}]（来源：${chunk.documentTitle}）\n${chunk.content}`).join('\n\n---\n\n');
}

/** 带向量化的入库：切块 →（可选）embedding → 写入 chunks 表 */
export async function ingestDocument(params: { kbId: number; documentId: number; content: string }): Promise<{ chunkCount: number; embedded: boolean }> {
    const chunks = chunkText(params.content);
    if (chunks.length === 0) return { chunkCount: 0, embedded: false };

    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, params.kbId));
    if (!kb) throw new Error('知识库不存在');

    let embedded = false;
    let embeddingModel: string | null = null;
    let embeddings: number[][] | null = null;

    if (kb.embeddingProviderId && kb.embeddingModel) {
        const [provider] = await db
            .select()
            .from(aiProviders)
            .where(and(eq(aiProviders.id, kb.embeddingProviderId), eq(aiProviders.enabled, true)));
        if (provider?.baseUrl) {
            embeddings = await embedTexts(provider, kb.embeddingModel, chunks);
            embeddingModel = kb.embeddingModel;
            embedded = true;
        }
    }

    await db.insert(knowledgeChunks).values(
        chunks.map((content, index) => ({
            documentId: params.documentId,
            kbId: params.kbId,
            seq: index,
            content,
            embedding: embeddings ? (embeddings[index] ?? null) : null,
            embeddingModel,
        })),
    );

    await db
        .update(knowledgeDocuments)
        .set({ chunkCount: chunks.length, status: embedded ? 'embedded' : 'ready', updatedAt: new Date() })
        .where(eq(knowledgeDocuments.id, params.documentId));

    return { chunkCount: chunks.length, embedded };
}
