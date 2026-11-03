import { eq } from 'drizzle-orm';
import { knowledgeBases } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { retrieveContext } from '../../../../utils/embedding';
import { gateExpensiveCalls } from '../../../../utils/expensive-gate';
import { requireMethod } from '../../../../utils/method';
import { stringParam } from '../../../../utils/query';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../../utils/request-body';
import { routeId } from '../../../../utils/route-id';

/** 检索测试：返回与查询最相关的知识库片段。 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    const kbId = routeId(event, 'kbId', '知识库');
    // 重复参数（`?q=a&q=b`）h3 给出数组：`as string` 那版会在下游字符串处理里抛 TypeError → 500；
    // 只判 typeof 的版本则把它折成「没有 q」→ 400，客户端明明带了查询词。
    // 与其余筛选参数统一取第一个。
    const q = stringParam(getQuery(event).q) ?? '';
    if (!q) throw createError({ statusCode: 400, statusMessage: '缺少查询参数 q' });
    // 检索测试不是纯读：retrieveContext 会先为查询词打一次 embedding 外呼（带 RAG_EMBED_BUDGET_MS 预算），
    // 再把该库分块扫进内存算余弦。闸门排在形状校验之后、任何外部调用之前：
    // 少一个 q 的 400 不该消耗额度，而超限的请求连那次外呼都不会发出。
    await gateExpensiveCalls(`kb-search:${kbId}`, '检索测试', 30);

    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    if (!kb) throw createError({ statusCode: 404, statusMessage: '知识库不存在' });

    const { context, hits } = await retrieveContext([kbId], q, 5, 0);
    return { context, hits };
});
