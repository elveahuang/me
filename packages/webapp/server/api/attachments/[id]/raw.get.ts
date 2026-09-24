import { and, eq } from 'drizzle-orm';
import type { H3Event } from 'h3';
import { attachments } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireUser } from '../../../utils/guard';
import { getObject, resolveStoredStorageConfig } from '../../../utils/storage';

/** 响应体停摆时限：桶在响应头之后不再吐字节时，允许的最大空闲间隔 */
const BODY_STALL_TIMEOUT_MS = 30_000;

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
    guardBodyStall(event, body, row.id);
    return sendStream(event, body as never);
});

/**
 * 响应体停摆时限。
 *
 * `createS3Client` 的 `requestTimeout` 只管到「拿到响应头」（见 §6 存储那条），而 `sendStream` 之后
 * 是另一段生命周期：桶回了响应头就不再吐字节时，这条请求会一直占着客户端连接、上游 socket 和
 * 一个永不 settle 的 handler。这里用**响应 socket 的空闲超时**兜住：Node 在读写两个方向都会续期，
 * 所以慢但仍在推进的下载不会被误杀（实测 6s/15 段的持续传输不触发，停摆则在时限整点被切）。
 */
function guardBodyStall(event: H3Event, body: NodeJS.ReadableStream, attachmentId: string) {
    const res = event.node.res;
    res.setTimeout(BODY_STALL_TIMEOUT_MS, () => {
        console.error(`[attachments] 下载代理 ${attachmentId} 的响应体 ${Math.round(BODY_STALL_TIMEOUT_MS / 1000)}s 没有新字节，中断本次下载`);
        (body as unknown as { destroy?: () => void }).destroy?.();
        if (res.headersSent) {
            // 已经在给用户发文件了，改不了状态码，只能撕连接（客户端看到下载中断，可以重试）
            res.destroy();
            return;
        }
        // 一个字节都没出去，还能回一个可读的 502。但必须先摘掉上面按文件大小写死的
        // Content-Length：带着它回一小段文案，客户端等不到承诺的字节数，这条 502 最后
        // 变成「挂到超时再 abort」（探针里摘与不摘两种写法结果不同）。
        res.removeHeader('Content-Length');
        res.statusCode = 502;
        res.end('文件读取超时，请稍后重试');
    });
    // 这个超时挂在 socket 上，而 keep-alive 连接会被后续请求复用：响应正常结束时不摘掉，
    // 下一条请求就会继承它（探针里是在成功响应后闲置 3s > 时限再发第二条，摘掉后才安全）。
    res.on('finish', () => res.setTimeout(0));
}
