import { and, desc, eq, sql } from 'drizzle-orm';
import type { StorageConfig } from '../db/schema';
import { attachments } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';
import { buildPublicUrl, pickStorageConfig, presignDownload, resolveStorageConfigMap } from '../utils/storage';

/**
 * 当前用户的附件列表。
 * 私有桶返回限时预签名 URL（签名在本地计算，不产生存储侧请求）。
 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const query = getQuery(event);
    const category = typeof query.category === 'string' && query.category !== 'all' ? query.category : undefined;
    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
    const page = Math.min(Math.max(1, Math.floor(Number(query.page)) || 1), 1e6); // 上界夹逼并取整：?page=Infinity/小数/超大值会让 offset 溢出或非整数而被 PG 拒绝
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 20), 100);

    const filters = [eq(attachments.userId, session.user.id)];
    if (category) filters.push(eq(attachments.category, category));
    if (keyword) filters.push(sql`${attachments.filename} ilike ${`%${keyword}%`}`);
    const where = and(...filters);

    // 列表、总数、分类统计三者互不依赖，一次并发发出，避免三次串行往返叠加到响应延迟。
    const [rows, [totalRow], stats] = await Promise.all([
        db
            .select()
            .from(attachments)
            .where(where)
            .orderBy(desc(attachments.createdAt))
            .limit(pageSize)
            .offset((page - 1) * pageSize),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(attachments)
            .where(where),
        db
            .select({
                category: attachments.category,
                count: sql<number>`count(*)::int`,
                bytes: sql<number>`coalesce(sum(${attachments.size}), 0)::bigint`,
            })
            .from(attachments)
            .where(eq(attachments.userId, session.user.id))
            .groupBy(attachments.category),
    ]);

    /**
     * 分类占用统计：无论当前筛选如何，都返回该用户的全量分布，
     * 这样切换分类时侧边统计不会跟着筛选结果跳动，用户能稳定看到"空间用在哪"。
     */
    const categoryStats = stats.map((row) => ({
        category: row.category,
        count: row.count,
        bytes: Number(row.bytes),
    }));
    const totalCount = categoryStats.reduce((sum, row) => sum + row.count, 0);
    const totalBytes = categoryStats.reduce((sum, row) => sum + row.bytes, 0);

    // 每条附件按各自的 storageConfigId 解析存储配置（去重后各查一次），
    // 避免用「当前默认配置」给分属其他桶的历史附件签出错误地址。
    const configMap = await resolveStorageConfigMap(rows.map((row) => row.storageConfigId));

    const items = await Promise.all(
        rows.map(async (row) => {
            const config = pickStorageConfig(configMap, row.storageConfigId);
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

    return {
        attachments: items,
        total: totalRow?.count ?? 0,
        page,
        pageSize,
        stats: {
            totalCount,
            totalBytes,
            byCategory: categoryStats,
        },
    };
});

async function safePresign(config: StorageConfig, key: string): Promise<string | null> {
    try {
        return await presignDownload(config, key);
    } catch {
        return null;
    }
}
