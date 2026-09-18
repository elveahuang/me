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
    let object: Awaited<ReturnType<typeof getObject>>;
    try {
        object = await getObject(config, row.objectKey);
    } catch (error) {
        // 不把 S3 SDK 的错误原文（含桶名/endpoint 等信息）透给客户端，只回通用状态码并留服务端日志。
        console.error('[attachments] 下载代理读取对象失败:', error);
        throw createError({ statusCode: 502, statusMessage: '文件暂时无法读取，请稍后重试' });
    }
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
