import { inArray } from 'drizzle-orm';
import type { KnowledgeBase, Provider } from '../db/schema';
import { kbChunks, knowledgeBases, providers } from '../db/schema';
import { db } from './db';

/** RAG：嵌入 + 暴力余弦检索（数据量小够用，后续可平滑切换 pgvector）。 */

export async function embedTexts(provider: Provider, model: string, texts: string[]): Promise<number[][]> {
    if (!provider.apiKey) {
        throw createError({ statusCode: 400, statusMessage: `供应商「${provider.name}」未配置 API Key，无法生成向量` });
    }
    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw createError({ statusCode: 502, statusMessage: `Embedding 请求失败（${res.status}）：${body.slice(0, 200)}` });
    }
    const json = (await res.json()) as { data?: { embedding: number[] }[] };
    if (!json.data?.length) {
        throw createError({ statusCode: 502, statusMessage: 'Embedding 响应格式异常' });
    }
    return json.data.map((d) => d.embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < n; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        dot += x * y;
        normA += x * x;
        normB += y * y;
    }
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 简单分段：按空行切段落，合并到 chunkSize 以内，带重叠。 */
export function chunkText(content: string, chunkSize = 800, overlap = 100): string[] {
    const paragraphs = content
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter(Boolean);
    const chunks: string[] = [];
    let current = '';
    for (const para of paragraphs) {
        if ((current + '\n\n' + para).length > chunkSize && current) {
            chunks.push(current);
            current = current.slice(-overlap) + '\n\n' + para;
        } else {
            current = current ? current + '\n\n' + para : para;
        }
        while (current.length > chunkSize * 2) {
            chunks.push(current.slice(0, chunkSize));
            current = current.slice(chunkSize - overlap);
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length ? chunks : [content.slice(0, chunkSize)];
}

export interface RetrievedChunk {
    score: number;
    content: string;
    documentId: string;
    kbId: string;
}

/** 提取文本的 bigram 集合（用于无 embedding 时的关键词重叠率匹配） */
export function bigrams(text: string): Set<string> {
    const normalized = text.toLowerCase().replace(/[\s\p{P}]+/gu, '');
    const set = new Set<string>();
    for (let i = 0; i < normalized.length - 1; i++) {
        set.add(normalized.slice(i, i + 2));
    }
    if (normalized.length === 1) {
        set.add(normalized);
    }
    return set;
}

export function bigramScore(query: string, content: string): number {
    const querySet = bigrams(query);
    if (querySet.size === 0) return 0;
    const contentSet = bigrams(content);
    if (contentSet.size === 0) return 0;
    let match = 0;
    for (const b of querySet) {
        if (contentSet.has(b)) match++;
    }
    return match / querySet.size;
}

export async function retrieveContext(kbIds: string[], query: string, topK = 5, minScore = 0.3): Promise<{ context: string; hits: RetrievedChunk[] }> {
    if (!kbIds.length || !query.trim()) return { context: '', hits: [] };

    const kbs = await db.select().from(knowledgeBases).where(inArray(knowledgeBases.id, kbIds));
    if (!kbs.length) return { context: '', hits: [] };

    const chunks = await db
        .select({
            id: kbChunks.id,
            kbId: kbChunks.kbId,
            documentId: kbChunks.documentId,
            content: kbChunks.content,
            embedding: kbChunks.embedding,
        })
        .from(kbChunks)
        .where(inArray(kbChunks.kbId, kbIds))
        .limit(5000);

    if (!chunks.length) return { context: '', hits: [] };

    // 多知识库可能配置了不同的嵌入模型/供应商，必须按知识库分别生成查询向量，
    // 否则跨模型向量比对（维度与语义空间都不同）会得到无意义的相关度。
    const providerRows = await db.select().from(providers);
    const byId = new Map(providerRows.map((p) => [p.id, p]));
    const enabledProviders = providerRows.filter((p) => p.enabled);
    const defaultProvider = enabledProviders.find((p) => p.isDefault) ?? enabledProviders[0];

    const chunksByKb = new Map<string, typeof chunks>();
    for (const chunk of chunks) {
        const list = chunksByKb.get(chunk.kbId);
        if (list) list.push(chunk);
        else chunksByKb.set(chunk.kbId, [chunk]);
    }

    const vectorHits: RetrievedChunk[] = [];
    const fallbackKbIds: string[] = [];

    for (const kb of kbs as KnowledgeBase[]) {
        const kbChunks = chunksByKb.get(kb.id) ?? [];
        if (!kbChunks.length) continue;

        const provider = (kb.embeddingProviderId ? byId.get(kb.embeddingProviderId) : undefined) ?? defaultProvider;
        if (!provider?.apiKey) {
            fallbackKbIds.push(kb.id);
            continue;
        }

        try {
            const [queryVector = []] = await embedTexts(provider, kb.embeddingModel, [query]);
            const scored = kbChunks
                .filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0)
                .map((c) => ({
                    score: cosineSimilarity(queryVector, c.embedding),
                    content: c.content,
                    documentId: c.documentId,
                    kbId: c.kbId,
                }))
                .filter((h) => h.score >= minScore);
            if (scored.length) vectorHits.push(...scored);
            else fallbackKbIds.push(kb.id);
        } catch (e) {
            console.warn(`[rag] 知识库「${kb.name}」向量检索异常，降级为关键词检索:`, e);
            fallbackKbIds.push(kb.id);
        }
    }

    // 向量不可用（或该库没有向量）时，用 Bigram 关键词打分兜底
    const fallbackHits: RetrievedChunk[] = [];
    for (const kbId of fallbackKbIds) {
        for (const c of chunksByKb.get(kbId) ?? []) {
            const score = bigramScore(query, c.content);
            if (score >= 0.08) {
                fallbackHits.push({ score, content: c.content, documentId: c.documentId, kbId: c.kbId });
            }
        }
    }

    // 有向量结果时以向量为准（关键词结果仅在完全没有向量命中时兜底），避免两套打分混排
    const hits = (vectorHits.length ? vectorHits : fallbackHits).sort((a, b) => b.score - a.score).slice(0, topK);

    const context = hits.map((h, i) => `[片段 ${i + 1} | 相关度 ${h.score.toFixed(2)}]\n${h.content}`).join('\n\n');
    return { context, hits };
}
