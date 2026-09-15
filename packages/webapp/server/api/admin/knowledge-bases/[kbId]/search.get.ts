import { eq } from 'drizzle-orm';
import { knowledgeBases } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { retrieveContext } from '../../../../utils/embedding';
import { requireAdmin } from '../../../../utils/guard';

/** 检索测试：返回与查询最相关的知识库片段。 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const kbId = getRouterParam(event, 'kbId')!;
    const q = (getQuery(event).q as string) || '';
    if (!q) throw createError({ statusCode: 400, statusMessage: '缺少查询参数 q' });

    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    if (!kb) throw createError({ statusCode: 404, statusMessage: 'Knowledge base not found' });

    const { context, hits } = await retrieveContext([kbId], q, 5, 0);
    return { context, hits };
});
