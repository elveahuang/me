import { eq, isNull } from 'drizzle-orm';
import { kbChunks } from '../server/db/schema';
import { db } from '../server/utils/db';

/**
 * 把已有的 1536 维 JSONB 向量回填到 `embedding_v`（P3-3）。
 * 幂等：只扫描 `embedding_v is null` 且 JSONB 长度正好 1536 的行；非 1536 维保持 null，继续走 JSONB 余弦。
 */
const BATCH = 200;

async function main() {
    let total = 0;
    for (;;) {
        const rows = await db.select({ id: kbChunks.id, embedding: kbChunks.embedding }).from(kbChunks).where(isNull(kbChunks.embeddingV)).limit(BATCH);
        if (!rows.length) break;
        let updated = 0;
        for (const row of rows) {
            if (Array.isArray(row.embedding) && row.embedding.length === 1536) {
                await db.update(kbChunks).set({ embeddingV: row.embedding }).where(eq(kbChunks.id, row.id));
                updated += 1;
            }
        }
        total += updated;
        console.log(`[embeddings] 扫描 ${rows.length} 行，回填 ${updated} 行，累计 ${total}`);
        // 本批没有可回填行时，剩余行都是非 1536 维，继续扫只会死循环
        if (updated === 0) break;
    }
    console.log(`[embeddings] 完成，共回填 ${total} 行`);
    await db.$client.end();
}

main().catch((error) => {
    console.error('[embeddings] 回填失败:', error);
    process.exit(1);
});
