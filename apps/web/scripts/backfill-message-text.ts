import { eq } from 'drizzle-orm';
import { messages } from '../server/db/schema';
import { closeDbClient, db } from '../server/utils/db';
import { partsToPlainText } from '../server/utils/message-text';

/**
 * 回填 messages.content_text（P3-6 检索索引）。
 * 只处理空串，已有内容不覆盖；可重复执行。
 */
async function main() {
    let scanned = 0;
    let updated = 0;
    for (;;) {
        const rows = await db.select({ id: messages.id, parts: messages.parts }).from(messages).where(eq(messages.contentText, '')).limit(500);
        if (!rows.length) break;
        for (const row of rows) {
            scanned += 1;
            const text = partsToPlainText(row.parts);
            if (!text) {
                // 没有纯文本的消息（纯附件/工具）也写一个空格，避免被反复扫到；检索时不会命中。
                await db.update(messages).set({ contentText: ' ' }).where(eq(messages.id, row.id));
                continue;
            }
            await db.update(messages).set({ contentText: text }).where(eq(messages.id, row.id));
            updated += 1;
        }
        if (rows.length < 500) break;
    }
    console.log(`[backfill] messages.content_text：扫描 ${scanned} 条，写入文本 ${updated} 条`);
}

try {
    await main();
} finally {
    await closeDbClient();
}
