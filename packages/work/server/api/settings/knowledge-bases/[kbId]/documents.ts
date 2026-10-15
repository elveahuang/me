import { asc, eq } from 'drizzle-orm';
import { kbChunks, kbDocuments, knowledgeBases, providers } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { chunkText, embedTexts, INDEX_EMBED_BUDGET_MS } from '../../../../utils/embedding';
import { gateExpensiveCalls } from '../../../../utils/expensive-gate';
import { requireMethod } from '../../../../utils/method';
import { stripNull } from '../../../../utils/pg-text';
import { intParam } from '../../../../utils/query';
import { capBody } from '../../../../utils/request-body';
import { routeId } from '../../../../utils/route-id';

/** 正文体积上限：两条上传通道共用，此前只有 multipart 分支受限，JSON 分支可以塞任意大小正文 */
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
/**
 * 解析前的请求体闸门。
 *
 * 与附件中转上传同一思路：readMultipartFormData / readBody 都会先把整个请求体读进内存，
 * 2MB 的检查在解析**之后**才执行，挡不住并发大请求的内存放大。
 * 余量要同时容纳 multipart 的边界/字段名开销，以及 JSON 转义膨胀（正文里的换行与引号
 * 在字符串字面量里各占两个字符），所以按 2 倍正文上限 + 64KB 计算；
 * 这个值同时用作**实际读取**的封顶（由下面的 `capBody` 按字节读完并写回 h3 的 raw body 缓存位），
 * 因此不带 Content-Length 的 chunked 请求也只能把这么多字节留在内存里，而不是读完了才发现超限。
 */
const MAX_REQUEST_BYTES = 2 * MAX_DOCUMENT_BYTES + 64 * 1024;
/** 标题会进管理端列表与检索片段头部展示；正文有 2MB 闸门，标题此前完全不设限 */
const DOCUMENT_TITLE_MAX = 200;

/** 长度超限直接 400：不受限的标题会整条进列表接口与检索片段头部 */
function assertTitleLen(value: string): string {
    if (value.length > DOCUMENT_TITLE_MAX) {
        throw createError({ statusCode: 400, statusMessage: `文档标题 过长（最多 ${DOCUMENT_TITLE_MAX} 字符）` });
    }
    return value;
}
/** 与 reindex 保持一致：嵌入接口按小批量提交，整篇一次请求容易超限或被供应商拒掉 */
const EMBED_BATCH_SIZE = 16;
/** 分块行同样分批插入：一条语句塞进上千行会撞 PostgreSQL 的参数量上限 */
const INSERT_BATCH_SIZE = 200;

export default defineEventHandler(async (event) => {
    // 2MB 正文要按这个端点自己的闸门收口，而不是写接口公共的 1MB（capBody 会按实际字节封顶读完
    // 并写回 h3 缓存位，两条解析通道复用它，chunked 因此也只能缓冲这么多）
    await capBody(event, MAX_REQUEST_BYTES);
    // 方法白名单排在查库之前：一个非法动词（PUT/PATCH/DELETE）原本要先付一次知识库行查询，
    // 再拿「知识库不存在」的 404 回来，读者会以为是库的问题而不是方法拼错了——顺序与同目录其它端点保持一致。
    // 守卫本身也不能省：少了它，PUT/PATCH/DELETE 会落进下面的读取分支，拿到 200 + 列表，看起来像写成功了。
    const method = requireMethod(event, ['GET', 'POST']);
    const kbId = routeId(event, 'kbId', '知识库');

    // 只闸 POST：GET 是选中知识库时自动发的列表请求（reloadDocs），给它计额度会让正常浏览处处碰壁。
    // 闸门排在查库之前——否则「知识库不存在」的 404 会先被消费掉一次额度，验证也看不出顺序对不对。
    // 一次文档写入 = 分块 + 按 EMBED_BATCH_SIZE 逐批打 /embeddings（INDEX_EMBED_BUDGET_MS 预算），
    // 上限按「人手往一个库里连投文档」的节奏给，只挡脚本与重复提交。
    if (method === 'POST') await gateExpensiveCalls(`kb-doc-write:${kbId}`, '文档入库', 30);

    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId));
    if (!kb) throw createError({ statusCode: 404, statusMessage: '知识库不存在' });

    if (method === 'POST') {
        let title = '未命名文档';
        let content = '';

        const contentType = getHeader(event, 'content-type') ?? '';
        if (contentType.includes('multipart/form-data')) {
            const parts = (await readMultipartFormData(event)) ?? [];
            const filePart = parts.find((p) => p.name === 'file');
            const titlePart = parts.find((p) => p.name === 'title');
            if (!filePart) throw createError({ statusCode: 400, statusMessage: '缺少 file 字段' });
            content = filePart.data.toString('utf-8');
            title = titlePart?.data.toString('utf-8') || filePart.filename || '未命名文档';
        } else {
            const body = ((await readBody(event)) ?? {}) as { title?: unknown; content?: unknown };
            // 只接受字符串：数字/对象会让 drizzle 把非文本值带进 SQL 并抛 500
            title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '未命名文档';
            content = typeof body.content === 'string' ? body.content : '';
        }

        // 两条通道的标题都要归一：multipart 分支此前连 trim 都没做，
        // 长度不受限的标题会整条进列表接口与检索片段头部
        title = assertTitleLen(stripNull(title).trim());
        // 按 UTF-8 解码上传的字节很可能带 NUL（选到二进制文件时整篇都是），
        // 而 PostgreSQL 的 text 列一律拒绝它——不剔除就是一条 500 把 insert 语句原文带回界面
        content = stripNull(content);
        if (Buffer.byteLength(content, 'utf-8') > MAX_DOCUMENT_BYTES) {
            throw createError({ statusCode: 400, statusMessage: '文档内容超过 2MB 限制' });
        }
        if (!content.trim()) {
            throw createError({ statusCode: 400, statusMessage: '文档内容为空' });
        }

        // 解析嵌入供应商：KB 指定 > 默认启用供应商
        let provider = undefined;
        if (kb.embeddingProviderId) {
            [provider] = await db.select().from(providers).where(eq(providers.id, kb.embeddingProviderId));
        }
        if (!provider) {
            const rows = await db.select().from(providers).where(eq(providers.enabled, true));
            provider = rows.find((p) => p.isDefault) ?? rows[0];
        }
        // 分块 + 嵌入（具备向量失败自动降级纯文本索引机制）
        const chunks = chunkText(content);
        let vectors: number[][] = [];
        const providerName = provider?.name ?? '离线 Bigram 索引';

        if (provider) {
            // 整篇文档的所有嵌入批次共用一条预算（见 embedding.ts 的 INDEX_EMBED_BUDGET_MS）。
            // 预算耗尽后剩余分块直接按「无向量」落库，走 Bigram 关键词检索，不再是每批各等 30 秒。
            const embedDeadline = AbortSignal.timeout(INDEX_EMBED_BUDGET_MS);
            for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
                const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
                if (embedDeadline.aborted) {
                    console.warn(
                        `[documents] 嵌入总预算（${INDEX_EMBED_BUDGET_MS}ms）用尽，offset=${i} 之后的 ${chunks.length - i} 个分块降级为 Bigram 纯文本索引`,
                    );
                    while (vectors.length < chunks.length) vectors.push([]);
                    break;
                }
                try {
                    const batchVectors = await embedTexts(provider, kb.embeddingModel, batch, embedDeadline);
                    // 供应商少返回时补空向量，保持 vectors 与 chunks 下标对齐
                    batch.forEach((_, j) => vectors.push(batchVectors[j] ?? []));
                } catch (error) {
                    console.warn(`[documents] 批次向量生成失败（offset=${i}），该批降级为 Bigram 纯文本索引:`, error);
                    batch.forEach(() => vectors.push([]));
                }
            }
        } else {
            vectors = chunks.map(() => []);
        }

        const docId = crypto.randomUUID();
        /**
         * 文档行与分块行必须同事务写入。
         * 分两次独立 insert 时，若分块写入失败会留下 chunkCount > 0 但实际无分块的文档，
         * 检索侧读到它会永远命中不到内容，且管理端只显示"已就绪"。
         */
        await db.transaction(async (tx) => {
            await tx.insert(kbDocuments).values({
                id: docId,
                kbId,
                title,
                content,
                chunkCount: chunks.length,
                status: 'ready',
            });
            for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
                const batch = chunks.slice(i, i + INSERT_BATCH_SIZE);
                await tx.insert(kbChunks).values(
                    batch.map((content_, j) => ({
                        id: crypto.randomUUID(),
                        kbId,
                        documentId: docId,
                        content: content_,
                        embedding: vectors[i + j] ?? [],
                    })),
                );
            }
        });

        const [row] = await db.select().from(kbDocuments).where(eq(kbDocuments.id, docId));
        return { ...row, provider: providerName };
    }

    // 文档列表限制条数：单个知识库可能有大量文档，全量返回会拖慢管理端。
    // 保持返回数组（管理端直接把响应赋给列表），只做上限截断而不改响应结构。
    // 不选 content：正文可能有整篇文档大小，列表页只需标题/分块数/状态，避免一次拉回全部正文。
    const query = getQuery(event);
    const limit = intParam(query.limit, 200, 1, 500);
    return db
        .select({
            id: kbDocuments.id,
            kbId: kbDocuments.kbId,
            title: kbDocuments.title,
            chunkCount: kbDocuments.chunkCount,
            status: kbDocuments.status,
            createdAt: kbDocuments.createdAt,
        })
        .from(kbDocuments)
        .where(eq(kbDocuments.kbId, kbId))
        .orderBy(asc(kbDocuments.createdAt))
        .limit(limit);
});
