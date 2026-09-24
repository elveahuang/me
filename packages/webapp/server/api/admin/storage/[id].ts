import { eq } from 'drizzle-orm';
import { attachments, storageConfigs } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { requireMethod } from '../../../utils/method';
import { invalidateStorageConfigCache, sanitizeStorageConfig } from '../../../utils/storage';

/**
 * 存储配置详情 / 删除。
 * DELETE 前先统计引用该配置的附件数量：有引用时阻止删除（避免出现无法访问的孤儿附件），
 * 除非显式传 `?force=1`（此时附件记录保留但 storageConfigId 置空，只能手工清理）。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    // PATCH 由同目录的 `[id].patch.ts` 接管；这里只留详情与删除，其余方法不再被当作读
    const method = requireMethod(event, ['GET', 'DELETE']);
    const id = getRouterParam(event, 'id')!;

    if (method === 'DELETE') {
        const force = getQuery(event).force === '1' || getQuery(event).force === 'true';
        // 「读这行 → 查引用 → 删除」必须在一个事务里，且开头那步要锁住待删行，否则两次检查都是过去式：
        // - 并发上传刚把 storageConfigId 指过来，删除就把它 SET NULL 成一条不知道自己原本属于哪个桶的记录
        //   （attachments.storage_config_id 是 onDelete: 'set null'，PG 不会替我们拦住）；
        // - 另一个管理员刚把它设为默认（`admin/storage.ts` 的「清掉其它默认 + 设自己为默认」就是这套事务），
        //   删完系统就没有默认存储了。
        // 行上的 FOR UPDATE 与这些写入在父行上取的 FK 锁互斥，窗口因此关死（新写入要么先被查到，要么排到删除之后）。
        await db.transaction(async (tx) => {
            const [locked] = await tx.select().from(storageConfigs).where(eq(storageConfigs.id, id)).for('update');
            if (!locked) throw createError({ statusCode: 404, statusMessage: '存储配置不存在' });

            const used = await tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.storageConfigId, id)).limit(1);
            if (used.length && !force) {
                throw createError({ statusCode: 409, statusMessage: '该存储下仍有附件，请先清理附件或使用强制删除' });
            }
            if (locked.isDefault) {
                throw createError({ statusCode: 409, statusMessage: '默认存储不可删除，请先将其他配置设为默认' });
            }
            await tx.delete(storageConfigs).where(eq(storageConfigs.id, id));
        });
        invalidateStorageConfigCache();
        return { ok: true };
    }

    const [row] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '存储配置不存在' });

    return sanitizeStorageConfig(row);
});
