import { and, desc, eq, sql } from 'drizzle-orm';
import { attachments, storageConfigs, user } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { buildPublicUrl } from '../../utils/storage';

/**
 * 附件总览（管理端）。
 * 与用户端列表的区别：可跨用户查看、支持按用户/分类/文件名筛选，返回体积统计。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const query = getQuery(event);
    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
    const category = typeof query.category === 'string' && query.category !== 'all' ? query.category : '';
    const userId = typeof query.userId === 'string' && query.userId ? query.userId : '';
    const page = Math.min(Math.max(1, Math.floor(Number(query.page)) || 1), 1e6); // 上界夹逼并取整：?page=Infinity/小数/超大值会让 offset 溢出或非整数而被 PG 拒绝
    const pageSize = Math.min(Math.max(1, Math.floor(Number(query.pageSize)) || 20), 100);

    const filters = [];
    if (keyword) filters.push(sql`(${attachments.filename} ilike ${`%${keyword}%`} or ${user.email} ilike ${`%${keyword}%`})`);
    if (category) filters.push(eq(attachments.category, category));
    if (userId) filters.push(eq(attachments.userId, userId));
    const where = filters.length ? and(...filters) : undefined;

    const rows = await db
        .select({
            id: attachments.id,
            filename: attachments.filename,
            mimeType: attachments.mimeType,
            size: attachments.size,
            category: attachments.category,
            createdAt: attachments.createdAt,
            userId: attachments.userId,
            userName: user.name,
            userEmail: user.email,
            objectKey: attachments.objectKey,
            storageConfigId: attachments.storageConfigId,
            storageName: storageConfigs.name,
            storageEndpoint: storageConfigs.endpoint,
            storageBucket: storageConfigs.bucket,
            publicBaseUrl: storageConfigs.publicBaseUrl,
            forcePathStyle: storageConfigs.forcePathStyle,
        })
        .from(attachments)
        .innerJoin(user, eq(user.id, attachments.userId))
        .leftJoin(storageConfigs, eq(storageConfigs.id, attachments.storageConfigId))
        .where(where)
        .orderBy(desc(attachments.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${attachments.size}), 0)::bigint` })
        .from(attachments)
        .innerJoin(user, eq(user.id, attachments.userId))
        .where(where);

    const items = rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        mimeType: row.mimeType,
        size: row.size,
        category: row.category,
        createdAt: row.createdAt,
        userId: row.userId,
        userName: row.userName,
        userEmail: row.userEmail,
        objectKey: row.objectKey,
        storageName: row.storageName ?? '—',
        isImage: row.mimeType.startsWith('image/'),
        // 管理端只回传可公开访问的地址；私有桶不在这里签发 URL，避免列表接口对存储产生 N 次签名开销
        url: row.publicBaseUrl
            ? buildPublicUrl(
                  {
                      publicBaseUrl: row.publicBaseUrl,
                      endpoint: row.storageEndpoint ?? '',
                      bucket: row.storageBucket ?? '',
                      forcePathStyle: row.forcePathStyle ?? true,
                  },
                  row.objectKey,
              )
            : null,
    }));

    return {
        items,
        total: totalRow?.count ?? 0,
        totalBytes: Number(totalRow?.bytes ?? 0),
        page,
        pageSize,
    };
});
