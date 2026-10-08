import { eq, inArray } from 'drizzle-orm';
import type { KnowledgeBase, Provider } from '../db/schema';
import { kbChunks, knowledgeBases, providers } from '../db/schema';
import { db } from './db';
import { readCappedResponseText } from './outbound';

/** RAG：嵌入 + 暴力余弦检索（数据量小够用，后续可平滑切换 pgvector）。 */

/** 失败响应只需要前 200 字符拼进错误文案，多留余量给多字节文本 */
const EMBED_ERROR_BODY_MAX_BYTES = 2_000;

/** 成功响应上限：一批 16 条 × 常见 1024~3072 维浮点约 1MB 内，4MB 已留足余量 */
const EMBED_BODY_MAX_BYTES = 4_000_000;

/** 一次检索内所有查询向量请求共享的总预算；与改前单库的等待上限同量级，不再随库数线性叠加 */
const RAG_EMBED_BUDGET_MS = 30_000;

/**
 * 索引期（文档上传、重建索引）内**所有批次共享**的总预算。
 *
 * `embedTexts` 不传 signal 时只带单请求 30 秒上限，而这两个调用点都是「一批一批串行跑完全部
 * 分块」的循环：2MB 正文按 800/100 分块约 3000 块 ≈ 187 批，嵌入端点变成黑洞时每个调用方都要
 * 自己数到 187 × 30 秒（约 93 分钟）才会走到降级分支——期间那个管理请求一直占着，
 * 而重建索引连降级出口都没有，只会一直转圈。
 */
export const INDEX_EMBED_BUDGET_MS = 300_000;

/** 并发向供应商取查询向量的路数上限（别把嵌入端点一次打满） */
const RAG_EMBED_CONCURRENCY = 4;

/**
 * 单次检索扫描的分块总量上限。向量存成 JSONB 数组、余弦在应用层暴力算，
 * 所以这个数就是每次对话在检索这一步的内存与 CPU 边界。
 */
const CHUNK_SCAN_BUDGET = 5000;

export async function embedTexts(provider: Provider, model: string, texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!provider.apiKey) {
        throw createError({ statusCode: 400, statusMessage: `供应商「${provider.name}」未配置 API Key，无法生成向量` });
    }
    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
        // 调用方给了共享预算就用它，否则退回单次请求的 30 秒上限
        signal: signal ?? AbortSignal.timeout(30000),
    });
    if (!res.ok) {
        const { text } = await readCappedResponseText(res, EMBED_ERROR_BODY_MAX_BYTES).catch(() => ({ text: '' }));
        throw createError({ statusCode: 502, statusMessage: `Embedding 请求失败（${res.status}）：${text.slice(0, 200)}` });
    }
    // 响应体大小由供应商决定（embedding 是浮点数组，本来就大），但必须有上限：
    // 原先的 res.text()/res.json() 会把整个 body 先缓冲进内存
    const { text, truncated } = await readCappedResponseText(res, EMBED_BODY_MAX_BYTES);
    if (truncated) {
        throw createError({ statusCode: 502, statusMessage: `Embedding 响应超过 ${EMBED_BODY_MAX_BYTES} 字节上限，已放弃本次向量结果` });
    }
    const json = JSON.parse(text) as { data?: { embedding: number[] }[] };
    if (!json.data?.length) {
        throw createError({ statusCode: 502, statusMessage: 'Embedding 响应格式异常' });
    }
    return json.data.map((d) => d.embedding);
}

/**
 * 余弦相似度。**维度不同即视为不可比，直接返回 0**，不再按 `Math.min` 截成公共前缀再算：
 * 换过嵌入模型（或供应商默认模型变了、重建索引只跑了一半）之后，历史分块的向量与本次查询向量
 * 既不同维度也不同语义空间，但截断前缀照样能算出一个像样的数——探针里 1024 维分块与 1536 维
 * 查询向量就得到 1.00，于是它以「相关度 1.00」被注入提示词，模型拿到的却是无意义的片段，
 * 日志里一个字都没有。真正的候选剔除在 `retrieveContext` 做（那里能给出维度、条数与「去重建索引」的指引）。
 */
function cosineSimilarity(a: number[], b: number[]): number {
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

interface RetrievedChunk {
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

/**
 * Bigram 重叠率打分。
 *
 * `query` 允许直接传查询文本，但在检索循环里必须传 bigrams() 的结果：这个函数在
 * retrieveContext 的兜底分支里是**每个分块**调一次（扫描预算 CHUNK_SCAN_BUDGET = 5000），
 * 每次重算 bigrams(query) 会把整段兜底从 O(分块总字数) 变成 O(查询长度 × 分块数)
 * （5000 块 × 20 万字查询实测 ≈100 秒），单线程 Node 上一次这样的检索就足以卡住
 * 同进程里的所有其它请求。
 */
export function bigramScore(query: string | ReadonlySet<string>, content: string): number {
    const querySet = typeof query === 'string' ? bigrams(query) : query;
    if (querySet.size === 0) return 0;
    const contentSet = bigrams(content);
    if (contentSet.size === 0) return 0;
    let match = 0;
    for (const b of querySet) {
        if (contentSet.has(b)) match++;
    }
    return match / querySet.size;
}

/**
 * 查询侧文本的长度封顶。
 *
 * 查询来自用户最后一条消息（chat.post.ts 直接给它原文），只受消息体积上限约束，一条 200KB 的
 * 「提问」在当前闸门下是完全合法的。超长文本对检索没有额外价值，却会把两处外部/CPU 成本放大：
 * 嵌入端点多半直接拒掉整段输入，Bigram 兜底更是按查询长度线性变贵（见 bigramScore）。
 * 超出部分截断，向量与关键词两条路径共用同一份截断后的文本。
 */
const RAG_QUERY_MAX_CHARS = 2000;

export async function retrieveContext(kbIds: string[], query: string, topK = 5, minScore = 0.3): Promise<{ context: string; hits: RetrievedChunk[] }> {
    const searchQuery = query.trim().slice(0, RAG_QUERY_MAX_CHARS);
    if (!kbIds.length || !searchQuery) return { context: '', hits: [] };

    const kbs = await db.select().from(knowledgeBases).where(inArray(knowledgeBases.id, kbIds));
    if (!kbs.length) return { context: '', hits: [] };

    // 分块预算按库均摊，且每库单独发一条带 LIMIT 的查询。
    // 原先是一条 `where kb_id in (...) limit 5000`：没有 ORDER BY 时 PostgreSQL 按物理顺序给出前 5000 行，
    // 于是「A 库 6000 个分块 + B 库 10 个」会整批取到 A 的行，B 库一个分块都进不了候选集——
    // 用户看到的现象是 B 库的知识永远检索不出来，而日志里什么都没有。
    // 均摊后每个库都有自己的一份扫描额度，总量仍受 CHUNK_SCAN_BUDGET 约束；单库扫描靠 kb_id 索引提前停止，
    // 不需要在库里做一次全量排序。
    const scanLimitPerKb = Math.max(1, Math.floor(CHUNK_SCAN_BUDGET / kbs.length));
    const chunksByKb = new Map<string, { id: string; kbId: string; documentId: string; content: string; embedding: number[] }[]>();
    let scanned = 0;
    for (const kb of kbs) {
        if (scanned >= CHUNK_SCAN_BUDGET) break;
        const rows = await db
            .select({
                id: kbChunks.id,
                kbId: kbChunks.kbId,
                documentId: kbChunks.documentId,
                content: kbChunks.content,
                embedding: kbChunks.embedding,
            })
            .from(kbChunks)
            .where(eq(kbChunks.kbId, kb.id))
            .limit(Math.min(scanLimitPerKb, CHUNK_SCAN_BUDGET - scanned));
        if (rows.length) chunksByKb.set(kb.id, rows);
        scanned += rows.length;
    }
    if (!chunksByKb.size) return { context: '', hits: [] };

    // 多知识库可能配置了不同的嵌入模型/供应商，必须按知识库分别生成查询向量，
    // 否则跨模型向量比对（维度与语义空间都不同）会得到无意义的相关度。
    const providerRows = await db.select().from(providers);
    const byId = new Map(providerRows.map((p) => [p.id, p]));
    const enabledProviders = providerRows.filter((p) => p.enabled);
    const defaultProvider = enabledProviders.find((p) => p.isDefault) ?? enabledProviders[0];

    const vectorHits: RetrievedChunk[] = [];
    const fallbackKbIds: string[] = [];

    // 查询向量按「(供应商, 嵌入模型)」归并：跨模型的向量维度与语义空间都不同，必须分开取；
    // 但同供应商同模型的多个知识库共用同一个查询向量，原先每个库都要再发一次。
    const groups: { provider: Provider; model: string; kbIds: string[] }[] = [];
    const groupIndex = new Map<string, number>();
    for (const kb of kbs as KnowledgeBase[]) {
        if (!(chunksByKb.get(kb.id) ?? []).length) continue;
        const provider = (kb.embeddingProviderId ? byId.get(kb.embeddingProviderId) : undefined) ?? defaultProvider;
        if (!provider?.apiKey) {
            fallbackKbIds.push(kb.id);
            continue;
        }
        const key = `${provider.id}\u0000${kb.embeddingModel}`;
        const existing = groupIndex.get(key);
        if (existing === undefined) {
            groupIndex.set(key, groups.length);
            groups.push({ provider, model: kb.embeddingModel, kbIds: [kb.id] });
        } else {
            groups[existing]!.kbIds.push(kb.id);
        }
    }

    // 各组请求互不依赖，原先却是逐个 await：嵌入端点黑洞时每库都烧满 30 秒超时，
    // 绑 10 个库就是 300 秒——配额已扣、限流窗口已占、用户只能干等。
    // 现在并发取向量（限 4 路，别把供应商一次打满）并共享一个总预算，
    // 预算与改前单库的等待上限同量级，最坏情况不再随库数线性放大。
    const deadline = AbortSignal.timeout(RAG_EMBED_BUDGET_MS);
    const queryVectors: (number[] | null)[] = new Array(groups.length).fill(null);
    let cursor = 0;
    const embedWorker = async (): Promise<void> => {
        for (;;) {
            const index = cursor++;
            const group = groups[index];
            if (!group) return;
            if (deadline.aborted) return; // 预算耗尽：剩下的组一律走关键词兜底
            try {
                const [vector = []] = await embedTexts(group.provider, group.model, [searchQuery], deadline);
                queryVectors[index] = vector;
            } catch (e) {
                console.warn(`[rag] 供应商「${group.provider.name}」(${group.model}) 生成查询向量失败，相关知识库降级为关键词检索:`, e);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(RAG_EMBED_CONCURRENCY, groups.length) }, embedWorker));

    for (const [index, group] of groups.entries()) {
        const queryVector = queryVectors[index];
        if (!queryVector?.length) {
            fallbackKbIds.push(...group.kbIds);
            continue;
        }
        for (const kbId of group.kbIds) {
            const candidates = (chunksByKb.get(kbId) ?? []).filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
            // 维度不同的分块不进候选集（而不是拿 0 分去和 minScore 比）：否则像检索测试那样
            // 传 minScore=0 时，不可比的向量仍会作为「相关度 0.00」的片段挤掉真正可用的结果。
            const comparable = candidates.filter((c) => c.embedding.length === queryVector.length);
            const skipped = candidates.length - comparable.length;
            if (skipped > 0) {
                const dims = [...new Set(candidates.filter((c) => c.embedding.length !== queryVector.length).map((c) => c.embedding.length))].sort(
                    (a, b) => a - b,
                );
                console.warn(
                    `[rag] 知识库 ${kbId} 有 ${skipped} 个分块的向量维度（${dims.join('/')}）与当前查询向量 ${queryVector.length} 不一致，已排除比较；该库本次退回关键词检索，需在管理端「重建索引」`,
                );
            }
            const scored = comparable
                .map((c) => ({
                    score: cosineSimilarity(queryVector, c.embedding),
                    content: c.content,
                    documentId: c.documentId,
                    kbId: c.kbId,
                }))
                .filter((h) => h.score >= minScore);
            if (scored.length) vectorHits.push(...scored);
            else fallbackKbIds.push(kbId);
        }
    }

    // 向量不可用（或该库没有向量）时，用 Bigram 关键词打分兜底
    const fallbackHits: RetrievedChunk[] = [];
    // 查询侧的 bigram 集合只算一次，理由见 bigramScore 的注释（按分块重算实测是百倍差距）
    const queryBigrams = bigrams(searchQuery);
    if (queryBigrams.size) {
        for (const kbId of fallbackKbIds) {
            for (const c of chunksByKb.get(kbId) ?? []) {
                const score = bigramScore(queryBigrams, c.content);
                if (score >= 0.08) {
                    fallbackHits.push({ score, content: c.content, documentId: c.documentId, kbId: c.kbId });
                }
            }
        }
    }

    // 有向量结果时以向量为准（关键词结果仅在完全没有向量命中时兜底），避免两套打分混排
    const hits = (vectorHits.length ? vectorHits : fallbackHits).sort((a, b) => b.score - a.score).slice(0, topK);

    const context = hits.map((h, i) => `[片段 ${i + 1} | 相关度 ${h.score.toFixed(2)}]\n${h.content}`).join('\n\n');
    return { context, hits };
}
