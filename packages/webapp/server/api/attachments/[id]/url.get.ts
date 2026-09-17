import { and, eq } from 'drizzle-orm';
import { attachments } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireUser } from '../../../utils/guard';
import { buildPublicUrl, presignDownload, resolveStorageConfig } from '../../../utils/storage';

/** 重新签发访问地址（私有桶预签名 URL 有有效期，前端过期后可再次获取） */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const id = getRouterParam(event, 'id')!;
    const query = getQuery(event);
    const download = query.download === '1' || query.download === 'true';

    const [row] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, id), eq(attachments.userId, session.user.id)));
    if (!row) {
        throw createError({ statusCode: 404, statusMessage: '附件不存在' });
    }

    const config = await resolveStorageConfig(row.storageConfigId);
    const url = download
        ? await presignDownload(config, row.objectKey, { filename: row.filename })
        : buildPublicUrl(config, row.objectKey) || (await presignDownload(config, row.objectKey));
    return { url, expiresIn: 3600, filename: row.filename };
});
