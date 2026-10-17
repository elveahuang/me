import { notes } from '../db/schema';

/**
 * 笔记对外的列集合：刻意不含 `embedding` / `embeddingModel` / `embeddingDim`。
 *
 * 向量是检索用的内部资产，一条 1024~1536 维的浮点数组序列化后是几十 KB，
 * 而 `select()` 的整行返回会把它们一并塞进创建/读取/更新的每一条响应里——
 * 界面拿不到任何用处，P7 的检索又直接查库，从来不走这些路由。
 * 新增列时记得同步这里，否则会静默变成「详情接口少一个字段」。
 */
export const noteColumns = {
    id: notes.id,
    title: notes.title,
    content: notes.content,
    kind: notes.kind,
    pinned: notes.pinned,
    tags: notes.tags,
    summary: notes.summary,
    createdAt: notes.createdAt,
    updatedAt: notes.updatedAt,
};
