import { and, eq } from 'drizzle-orm';
import { kbDocuments } from '../../../../../db/schema';
import { db } from '../../../../../utils/db';
import { requireMethod } from '../../../../../utils/method';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../../../utils/request-body';
import { routeId } from '../../../../../utils/route-id';

export default defineEventHandler(async (event) => {
    requireMethod(event, ['DELETE']);
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    const kbId = routeId(event, 'kbId', '知识库');
    const documentId = routeId(event, 'documentId', '文档');
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
