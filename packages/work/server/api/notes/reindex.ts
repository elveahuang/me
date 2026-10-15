import { gateExpensiveCalls } from '../../utils/expensive-gate';
import { requireMethod } from '../../utils/method';
import { NOTE_INDEX_BATCH_MAX, countUnindexedNotes, indexPendingNotes, resolveNoteEmbeddingTarget } from '../../utils/note-index';
import { capBody, readCappedJsonBody } from '../../utils/request-body';

/**
 * 笔记检索索引：状态查询与批量补索引。`GET|POST /api/notes/reindex`
 *
 * 保存笔记时已经会异步索引那一条（`scheduleNoteIndex`），这个入口管的是另外两种局面：
 * - 嵌入模型是后来才配的（此前的笔记全没有向量）；
 * - 换过模型（新旧向量维度不可比，检索时会被整批剔除）。
 * 所以它按批增量补齐而不是全库重刷：`limit` 默认一批 50 条，界面可以连点直到 `unindexed` 归零。
 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'GET') {
        const target = await resolveNoteEmbeddingTarget();
        return {
            unindexed: await countUnindexedNotes(),
            batchMax: NOTE_INDEX_BATCH_MAX,
            // 没配嵌入模型时不是错误，而是「只做摘要索引」这一状态，界面要能解释
            embedding: target ? { provider: target.provider.name, model: target.model } : null,
        };
    }

    // 一批 50 条 = 最多 50 次嵌入外呼（服务端按批合并成一次请求），是重成本入口
    await gateExpensiveCalls('note-index', '笔记索引重建', 6);
    const body = await readCappedJsonBody<Record<string, unknown>>(event);
    const limit = Number.isFinite(Number(body?.limit)) ? Number(body?.limit) : NOTE_INDEX_BATCH_MAX;
    const result = await indexPendingNotes(limit);
    return { ...result, unindexed: await countUnindexedNotes() };
});
