import { and, asc, count, eq, sql } from 'drizzle-orm';
import { kbChunks, knowledgeBases, providers } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { embedTexts, INDEX_EMBED_BUDGET_MS } from '../../../../utils/embedding';
import { gateExpensiveCalls } from '../../../../utils/expensive-gate';
import { requireMethod } from '../../../../utils/method';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../../utils/request-body';
import { routeId } from '../../../../utils/route-id';

const EMBED_BATCH_SIZE = 16;

/**
 * 每轮从库里取多少分块。原先是一条 SELECT 把该库**全部**分块（含正文）读进内存：
 * 一篇 2MB 文档按 800/100 分块约 3000 块，几个大库一起重建就是几百 MB 字符串常驻在
 * Nitro 进程里，而任一时刻手上真正需要的只有正在嵌入的那 16 条。
 */
const SCAN_PAGE_SIZE = 200;

/**
 * 一批向量用一条 `UPDATE ... FROM (VALUES ...)` 写完。
 * 逐行 UPDATE 在这里是「每 16 次嵌入配最多 16 次串行数据库往返」，几万块的知识库光写回就要几万次 round trip。
 * id 与向量都走参数绑定（sql 模板内插即绑定参数），不做字符串拼接。
 */
async function writeEmbeddings(rows: { id: string; embedding: number[] }[]) {
    if (!rows.length) return;
    await db.execute(sql`
        update ${kbChunks} as t
        set embedding = v.embedding
        from (values ${sql.join(
            rows.map((r) => sql`(${r.id}::text, ${JSON.stringify(r.embedding)}::jsonb)`),
            sql`, `,
        )}) as v(id, embedding)
        where t.id = v.id
    `);
}

/**
 * 重建知识库向量索引。
 *
 * 文档入库时若嵌入接口异常，会以空向量落库并降级为关键词检索；
 * 这里提供补偿入口：重新调用 /embeddings 为所有分块生成向量。
 *
 * 注意：目录名使用 [kbId]（与同级 [id].ts 区分），避免同段 param 名冲突导致路由匹配异常。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    const kbId = routeId(event, 'kbId', '知识库');
    // 整库重建是最贵的一条入口：一批 16 块配一轮 /embeddings 外呼，INDEX_EMBED_BUDGET_MS 之内可以连跑
    // 成百上千轮。并发跑两轮不只是浪费额度——两批 UPDATE ... FROM (VALUES) 会互相覆盖同一批分块，
    // 后提交的那轮把前一轮刚写好的向量原样盖掉，用户看到「重建完成」但库里是旧结果。
    // 阈值 5/分对人手点击足够宽松（一次重建本身就要跑几十秒以上），只挡循环与重复提交。
    await gateExpensiveCalls(`kb-reindex:${kbId}`, '索引重建', 5);

    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    if (!kb) throw createError({ statusCode: 404, statusMessage: '知识库不存在' });

    let provider = undefined;
    if (kb.embeddingProviderId) {
        [provider] = await db.select().from(providers).where(eq(providers.id, kb.embeddingProviderId));
    }
    if (!provider) {
        const rows = await db.select().from(providers).where(eq(providers.enabled, true));
        provider = rows.find((p) => p.isDefault) ?? rows[0];
    }
    if (!provider) {
        throw createError({ statusCode: 400, statusMessage: '没有可用的嵌入供应商，请先在「模型供应商」中配置' });
    }

    const [totalRow] = await db.select({ n: count() }).from(kbChunks).where(eq(kbChunks.kbId, kbId));
    const total = Number(totalRow?.n ?? 0);

    let updated = 0;
    let failed = 0;
    let lastError: string | null = null;
    /**
     * 全部批次共用一条时间预算（见 embedding.ts 的 INDEX_EMBED_BUDGET_MS）。
     * 重建索引没有 Bigram 兜底可退，所以预算用尽时必须**跳出循环**：
     * 继续跑只是让每个剩余批次各自立刻抛一次已中止的错误，白转几千圈。
     */
    const embedDeadline = AbortSignal.timeout(INDEX_EMBED_BUDGET_MS);
    let outOfBudget = false;
    /**
     * keyset 游标（created_at, id 严格递增）而不是 offset：重建期间管理员删掉一篇文档会级联删掉分块，
     * offset 分页会因此整体前移、把漏掉的那几块永久留在没有向量的状态。
     *
     * 游标里的时间戳由数据库自己用 `to_char` 渲染成文本，全程不经过 JavaScript：
     * `created_at` 是 `timestamp`（不带时区），早先的版本把行读成 Date 再 `toISOString()`、
     * 比较时又 `::timestamptz`，于是这趟往返要求「Node 进程时区 == PostgreSQL 会话 TimeZone」。
     * 两者一旦不一致（容器给 Node 设了 TZ、库端仍是 UTC，或应用连的是另一时区的库），
     * 游标就落到实际值之前几小时：下一页原样读回同一批行、永远走不到第 2 页，
     * 直到 `INDEX_EMBED_BUDGET_MS` 用尽，第 2 页之后的分块一个向量都拿不到。
     * 现在渲染与比较都留在 `timestamp` 域里，时区不再参与。
     * （仍不能裸传 Date：`sql` 模板里的值不经过列的 mapToDriverValue，
     * postgres-js 编码参数时会抛 ERR_INVALID_ARG_TYPE，实测整条请求 500。）
     */
    let cursor: { createdAt: string; id: string } | null = null;

    while (!outOfBudget) {
        const conditions = [eq(kbChunks.kbId, kbId)];
        if (cursor) conditions.push(sql`(${kbChunks.createdAt}, ${kbChunks.id}) > (${cursor.createdAt}::timestamp, ${cursor.id}::text)`);

        const page = await db
            .select({
                id: kbChunks.id,
                content: kbChunks.content,
                createdAtKey: sql<string>`to_char(${kbChunks.createdAt}, 'YYYY-MM-DD HH24:MI:SS.US')`,
            })
            .from(kbChunks)
            .where(and(...conditions))
            .orderBy(asc(kbChunks.createdAt), asc(kbChunks.id))
            .limit(SCAN_PAGE_SIZE);
        if (!page.length) break;
        const last = page[page.length - 1]!;
        cursor = { createdAt: last.createdAtKey, id: last.id };

        for (let i = 0; i < page.length; i += EMBED_BATCH_SIZE) {
            if (embedDeadline.aborted) {
                outOfBudget = true;
                break;
            }
            const batch = page.slice(i, i + EMBED_BATCH_SIZE);
            try {
                const vectors = await embedTexts(
                    provider,
                    kb.embeddingModel,
                    batch.map((c) => c.content),
                    embedDeadline,
                );
                const rows: { id: string; embedding: number[] }[] = [];
                for (let j = 0; j < batch.length; j++) {
                    const vector = vectors[j];
                    if (!vector?.length) {
                        failed++;
                        continue;
                    }
                    rows.push({ id: batch[j]!.id, embedding: vector });
                }
                await writeEmbeddings(rows);
                updated += rows.length;
            } catch (error) {
                console.error(`[reindex] 批次失败（kb=${kbId} after=${batch[batch.length - 1]?.id}）:`, error);
                failed += batch.length;
                lastError = error instanceof Error ? error.message : String(error);
            }
        }

        if (outOfBudget || page.length < SCAN_PAGE_SIZE) break;
    }

    if (outOfBudget) {
        failed += Math.max(0, total - updated - failed);
        lastError = `嵌入总预算（${INDEX_EMBED_BUDGET_MS}ms）用尽，本次只处理完 ${updated} 个分块`;
    }

    return {
        ok: failed === 0,
        knowledgeBase: { id: kb.id, name: kb.name, embeddingModel: kb.embeddingModel, provider: provider.name },
        total,
        updated,
        failed,
        lastError,
    };
});
