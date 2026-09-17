import { eq } from 'drizzle-orm';
import { attachments, storageConfigs } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { invalidateStorageConfigCache, sanitizeStorageConfig } from '../../../utils/storage';

/**
 * 存储配置详情 / 删除。
 * DELETE 前先统计引用该配置的附件数量：有引用时阻止删除（避免出现无法访问的孤儿附件），
 * 除非显式传 `?force=1`（此时附件记录保留但 storageConfigId 置空，只能手工清理）。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    const [row] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '存储配置不存在' });

    if (getMethod(event) === 'DELETE') {
        const used = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.storageConfigId, id)).limit(1);
        const force = getQuery(event).force === '1' || getQuery(event).force === 'true';
        if (used.length && !force) {
            throw createError({ statusCode: 409, statusMessage: '该存储下仍有附件，请先清理附件或使用强制删除' });
        }
        if (row.isDefault) {
            throw createError({ statusCode: 409, statusMessage: '默认存储不可删除，请先将其他配置设为默认' });
        }
        await db.delete(storageConfigs).where(eq(storageConfigs.id, id));
        invalidateStorageConfigCache();
        return { ok: true };
    }

    return sanitizeStorageConfig(row);
});
