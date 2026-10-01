import { eq } from 'drizzle-orm';
import { knowledgeBases } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { retrieveContext } from '../../../../utils/embedding';
import { requireAdmin } from '../../../../utils/guard';

/** 检索测试：返回与查询最相关的知识库片段。 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const kbId = getRouterParam(event, 'kbId')!;
    // `as string` 是空头承诺：?q=a&q=b 会给出数组，数组进 retrieveContext 的字符串处理即抛 TypeError → 500
    const rawQuery = getQuery(event).q;
    const q = typeof rawQuery === 'string' ? rawQuery.trim() : '';
    if (!q) throw createError({ statusCode: 400, statusMessage: '缺少查询参数 q' });

    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    if (!kb) throw createError({ statusCode: 404, statusMessage: '知识库不存在' });

    const { context, hits } = await retrieveContext([kbId], q, 5, 0);
    return { context, hits };
});
