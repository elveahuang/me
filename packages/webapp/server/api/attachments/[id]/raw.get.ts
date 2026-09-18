import { and, eq } from 'drizzle-orm';
import { attachments } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireUser } from '../../../utils/guard';
import { getObject, resolveStoredStorageConfig } from '../../../utils/storage';

/**
 * 附件下载代理。
 *
 * 用途：桶未开放公共读、且客户端无法直连对象存储（内网地址 / 证书自签）时的兜底通道。
 * 只有附件所有者可以下载，未登录或越权均返回 404，不泄露对象是否存在。
 */
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

    const config = await resolveStoredStorageConfig(row.storageConfigId);
    const object = await getObject(config, row.objectKey);
    const body = object.Body as unknown as NodeJS.ReadableStream | undefined;
    if (!body) {
        throw createError({ statusCode: 502, statusMessage: '对象存储未返回文件内容' });
    }

    setHeader(event, 'Content-Type', object.ContentType || row.mimeType || 'application/octet-stream');
    if (object.ContentLength) setHeader(event, 'Content-Length', Number(object.ContentLength));
    setHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
    setHeader(event, 'Cache-Control', 'private, max-age=300');
    return sendStream(event, body as never);
});
