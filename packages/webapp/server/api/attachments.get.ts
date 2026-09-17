import { and, desc, eq, sql } from 'drizzle-orm';
import { attachments } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';
import { buildPublicUrl, presignDownload, resolveStorageConfig } from '../utils/storage';

/**
 * 当前用户的附件列表。
 * 私有桶返回限时预签名 URL（签名在本地计算，不产生存储侧请求）。
 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const query = getQuery(event);
    const category = typeof query.category === 'string' && query.category !== 'all' ? query.category : undefined;
    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 20), 100);

    const filters = [eq(attachments.userId, session.user.id)];
    if (category) filters.push(eq(attachments.category, category));
    if (keyword) filters.push(sql`${attachments.filename} ilike ${`%${keyword}%`}`);
    const where = and(...filters);

    const rows = await db
        .select()
        .from(attachments)
        .where(where)
        .orderBy(desc(attachments.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(attachments)
        .where(where);

    // 同一份存储配置只解析一次
    let config = null;
    try {
        config = await resolveStorageConfig(null);
    } catch {
        config = null;
    }

    const items = await Promise.all(
        rows.map(async (row) => {
            const publicUrl = config ? buildPublicUrl(config, row.objectKey) : null;
            const url = publicUrl ?? (config ? await safePresign(config, row.objectKey) : null);
            return {
                id: row.id,
                filename: row.filename,
                mimeType: row.mimeType,
                size: row.size,
                category: row.category,
                createdAt: row.createdAt,
                url,
                isImage: row.mimeType.startsWith('image/'),
            };
        }),
    );

    return { attachments: items, total: totalRow?.count ?? 0, page, pageSize };
});

async function safePresign(config: Awaited<ReturnType<typeof resolveStorageConfig>>, key: string): Promise<string | null> {
    try {
        return await presignDownload(config, key);
    } catch {
        return null;
    }
}
