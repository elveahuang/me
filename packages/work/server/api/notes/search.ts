import { gateExpensiveCalls } from '../../utils/expensive-gate';
import { requireMethod } from '../../utils/method';
import { searchNotes } from '../../utils/note-search';
import { intParam, stringParam } from '../../utils/query';
import { capBody } from '../../utils/request-body';

/**
 * 笔记语义检索：`GET /api/notes/search?q=...&limit=`
 *
 * 与 `/api/notes?keyword=` 的分工：那条是列表页的字面筛选（SQL ilike，不打分），
 * 这里回答「我记过和 X 有关的东西吗」——先向量、拿不到再 Bigram 重叠，并按相关性排序。
 *
 * 走独立路径而不是塞进 `/api/notes` 的查询参数，是因为它每次都要外呼一次嵌入端点，
 * 需要一个和列表刷新分开的频控口径。
 */
export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);
    const query = getQuery(event);

    const q = stringParam(query.q, 512) ?? '';
    if (!q.trim()) return { q: '', mode: 'none', hits: [] };

    // 每次检索 = 一次嵌入外呼，而笔记页的搜索框是「边打字边搜」的交互：没有这一道，
    // 一次停顿就能把供应商打满，而 Nitro 进程会跟着请求一起堆等待。
    await gateExpensiveCalls('note-search', '笔记语义检索', 20);

    const limit = intParam(query.limit, 10, 1, 50);
    const hits = await searchNotes(q, { limit });
    return {
        q,
        // 命中方式随响应回传：界面据此说明「这是语义近似」还是「字面匹配」，
        // 供应商没配嵌入模型时用户看到的不是「搜不到」而是一次可解释的降级。
        mode: hits[0]?.mode ?? 'none',
        staleVectors: hits[0]?.staleVectors ?? 0,
        hits: hits.map((h) => ({ id: h.id, title: h.title, summary: h.summary, updatedAt: h.updatedAt, score: Number(h.score.toFixed(4)), mode: h.mode })),
    };
});
