import { requireUser } from '../utils/guard';
import { rateLimit } from '../utils/rate-limit';
import { readCappedBodyIntoH3Cache } from '../utils/request-body';
import {
    assertRelayPayloadSize,
    assertRelayRequestAllowed,
    assertUserStorageQuota,
    buildObjectKey,
    buildPublicUrl,
    deleteObject,
    isMimeAllowed,
    normalizeAttachmentCategory,
    normalizeMimeType,
    presignDownload,
    putObject,
    registerAttachmentWithinQuota,
    relayReadLimitBytes,
    resolveStorageConfig,
    sanitizeFilename,
    warnPresignFailure,
} from '../utils/storage';

/**
 * 上传附件（服务端中转）。
 *
 * multipart/form-data：file（必填）+ category（可选）
 * 走服务端 putObject 而不是前端直传，原因：
 * 自建对象存储（RustFS / MinIO）通常没有配置浏览器跨域规则，直传会先在 CORS 预检失败。
 * 超过 RELAY_UPLOAD_HARD_LIMIT_MB 的文件应改用 POST /api/attachments/presign 直传。
 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);

    // 中转上传每次都会真实 putObject 到对象存储；体积闸门只挡单请求大小、挡不住频率，
    // 放在读体之前让超限请求连正文都不必读（正文最大 64MB+64KB 协议开销）
    const limited = await rateLimit(`attach-relay:${session.user.id}`, 30, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }

    // 解析请求体前先按 Content-Length 拦截，避免超大请求被整体读入内存
    const config = await resolveStorageConfig(null);
    assertRelayRequestAllowed(getHeader(event, 'content-length'), config.maxFileSizeMb);

    // Content-Length 是客户端自己声明的，chunked 更是压根没有这个头——只靠上面那道预检，
    // readMultipartFormData 会把任意大的正文整个缓冲进内存（它只接受读完后的一整段 Buffer）。
    // 所以这里按**实际字节**封顶，并把读到的字节塞进 h3 自己的 raw body 缓存位，让下面的解析器复用。
    if ((getHeader(event, 'content-type') ?? '').startsWith('multipart/form-data')) {
        await readCappedBodyIntoH3Cache(event, relayReadLimitBytes(config.maxFileSizeMb));
    }

    const parts = (await readMultipartFormData(event)) ?? [];
    const filePart = parts.find((part) => part.name === 'file');
    if (!filePart) {
        throw createError({ statusCode: 400, statusMessage: '缺少 file 字段' });
    }
    const categoryPart = parts.find((part) => part.name === 'category');
    const category = normalizeAttachmentCategory(categoryPart?.data.toString('utf-8'));

    const filename = sanitizeFilename(filePart.filename || 'file');
    const mimeType = normalizeMimeType(filePart.type);
    const size = filePart.data.length;

    // 兜底：伪造 Content-Length 或 chunked 请求在解析后再次校验
    assertRelayPayloadSize(size, config.maxFileSizeMb);
    if (!isMimeAllowed(config, mimeType)) {
        throw createError({ statusCode: 400, statusMessage: `该存储不允许上传 ${mimeType} 类型文件` });
    }
    if (!config.accessKeyId || !config.secretAccessKey) {
        throw createError({ statusCode: 503, statusMessage: '对象存储缺少访问密钥，请在管理后台补全配置' });
    }
    await assertUserStorageQuota(session.user.id, size);

    const objectKey = buildObjectKey(config, filename, category);
    try {
        await putObject(config, objectKey, filePart.data, mimeType);
    } catch (error) {
        // SDK 错误原文可能带 endpoint/RequestID，只进服务端日志，响应回泛化文案
        console.error('[attachments] 对象存储上传失败:', error);
        throw createError({ statusCode: 502, statusMessage: '对象存储上传失败，请检查存储配置或稍后重试' });
    }

    const id = crypto.randomUUID();
    let registered: Awaited<ReturnType<typeof registerAttachmentWithinQuota>>;
    try {
        // 闸门 + 落库在同一事务里持用户级锁：并发上传时后一个请求一定读得到前一个已登记的体积
        registered = await registerAttachmentWithinQuota({
            id,
            userId: session.user.id,
            storageConfigId: config.id,
            objectKey,
            filename,
            mimeType,
            size,
            category,
        });
    } catch (error) {
        // 预检之后仍有并发把配额用满：对象已经上桶，必须清掉，否则越限内容留在桶里却没有记录（也就再也删不掉）
        await deleteObject(config, objectKey).catch((cleanupError) =>
            console.warn(`[attachments] 清理上传失败对象出错（key=${objectKey}）:`, (cleanupError as Error)?.message || cleanupError),
        );
        throw error;
    }

    const publicUrl = buildPublicUrl(config, objectKey);
    let url = publicUrl;
    if (!url) {
        try {
            url = await presignDownload(config, objectKey);
        } catch (error) {
            warnPresignFailure(config.id, objectKey, error);
            url = null;
        }
    }

    return {
        // 用登记结果里的 id：objectKey 由本次请求新生成，正常恒等于本地 id，
        // 但响应里的 id 必须是「库里真的存在的那一行」，不能是未经校验的本地变量
        id: registered.id,
        filename,
        mimeType,
        size,
        category,
        createdAt: new Date().toISOString(),
        url,
        isImage: mimeType.startsWith('image/'),
    };
});
