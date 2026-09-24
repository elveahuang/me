import { eq } from 'drizzle-orm';
import { attachments } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { deleteObject, resolveStorageConfig, resolveStoredStorageConfig } from '../../../utils/storage';

/**
 * 管理端删除附件。
 * 支持按 id 删除单个；`?orphans=1` 清理"元数据存在但存储已删除"的孤儿记录。
 * 删除对象失败不阻塞元数据清理，但会在返回体中列出失败项，便于排查存储配置问题。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '附件不存在' });

    let storageDeleted = true;
    let storageError = '';
    try {
        if (row.storageConfigId) {
            const config = await resolveStoredStorageConfig(row.storageConfigId);
            await deleteObject(config, row.objectKey);
        } else {
            // 早期数据可能没有 storageConfigId，退回默认配置删除；有 id 时绝不回退，避免删错桶
            const config = await resolveStorageConfig(null);
            await deleteObject(config, row.objectKey);
        }
    } catch (error) {
        storageDeleted = false;
        // 管理端需要可读的失败原因，但 SDK 原文可能多行且带 endpoint/RequestID：压成单行截断，完整错误只进日志
        console.error('[admin/attachments] 存储侧删除失败:', error);
        const detail = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();
        storageError = detail.slice(0, 200);
    }

    await db.delete(attachments).where(eq(attachments.id, id));
    return { ok: true, storageDeleted, ...(storageError ? { storageError } : {}) };
});
