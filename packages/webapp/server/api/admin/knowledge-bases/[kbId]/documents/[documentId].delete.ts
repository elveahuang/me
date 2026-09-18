import { and, eq } from 'drizzle-orm';
import { kbDocuments } from '../../../../../db/schema';
import { db } from '../../../../../utils/db';
import { requireAdmin } from '../../../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const kbId = getRouterParam(event, 'kbId')!;
    const documentId = getRouterParam(event, 'documentId')!;
    // 必须同时按 kbId 限定：否则任意 kb 下的 documentId 都能被删，且删除不存在/不归属的文档仍返回 ok。
    const deleted = await db
        .delete(kbDocuments)
        .where(and(eq(kbDocuments.id, documentId), eq(kbDocuments.kbId, kbId)))
        .returning({ id: kbDocuments.id });
    if (!deleted.length) {
        throw createError({ statusCode: 404, statusMessage: '文档不存在' });
    }
    return { ok: true };
});
