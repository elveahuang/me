import { and, eq } from 'drizzle-orm';
import { attachments } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';
import { deleteObject, resolveStoredStorageConfig } from '../../utils/storage';

/** 删除自己的附件（同时清理对象存储中的对象；存储不可用时仍删除元数据并记录告警） */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const id = getRouterParam(event, 'id')!;

    const [row] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, id), eq(attachments.userId, session.user.id)));
    if (!row) {
        throw createError({ statusCode: 404, statusMessage: '附件不存在' });
    }

    try {
        const config = await resolveStoredStorageConfig(row.storageConfigId);
        await deleteObject(config, row.objectKey);
    } catch (error) {
        console.warn('[attachments] 对象存储删除失败，仅移除元数据:', error);
    }

    await db.delete(attachments).where(eq(attachments.id, id));
    return { ok: true };
});
