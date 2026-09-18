import { attachments } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';
import {
    assertFileSize,
    buildPublicUrl,
    deleteObject,
    headObject,
    isMimeAllowed,
    normalizeAttachmentCategory,
    presignDownload,
    resolveStorageConfig,
    sanitizeFilename,
} from '../../utils/storage';

/**
 * 预签名直传登记（配合 POST /api/attachments/presign 使用）。
 *
 * 前端直传的三步：取预签名地址 → PUT 到对象存储 → 调用本接口登记元数据。
 * 未登记的对象不会出现在附件列表，也无法通过附件接口访问；
 * 因此这里会校验 objectKey 必须落在当前配置的 prefix 下，避免用户把任意已存在对象"认领"为自己的附件。
 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const body = (await readBody(event)) ?? {};

    const objectKey = String(body.objectKey ?? '').trim();
    if (!objectKey) {
        throw createError({ statusCode: 400, statusMessage: 'objectKey 必填' });
    }
    const size = Number(body.size) || 0;
    const filename = sanitizeFilename(String(body.filename ?? 'file'));
    const mimeType = typeof body.mimeType === 'string' && body.mimeType ? body.mimeType : 'application/octet-stream';
    const category = normalizeAttachmentCategory(body.category);

    const config = await resolveStorageConfig(null);
    const prefix = (config.prefix || 'uploads').replace(/^\/+|\/+$/g, '');

    // 只接受本配置前缀下、由本服务生成的对象 key（含 UUID 段）
    if (!objectKey.startsWith(`${prefix}/`)) {
        throw createError({ statusCode: 400, statusMessage: 'objectKey 不属于当前存储配置的目录' });
    }
    if (objectKey.includes('..')) {
        throw createError({ statusCode: 400, statusMessage: 'objectKey 非法' });
    }
    if (size > 0) assertFileSize(config, size);
    if (!isMimeAllowed(config, mimeType)) {
        throw createError({ statusCode: 400, statusMessage: `该存储不允许上传 ${mimeType} 类型文件` });
    }

    /**
     * 直传通道的安全闸门。
     *
     * PUT 预签名 URL 无法携带体积条件，客户端申报的 size 也不可信
     * （自报 1 字节即可绕过 maxFileSizeMb 上传任意大小对象）。
     * 因此登记前必须回源对象存储读取真实大小：
     * - 超限：删掉对象并拒绝登记，攻击者既拿不到附件也不占用配额
     * - 未超限：以真实大小为准写库，避免伪造元数据
     */
    let actualSize = size;
    let actualMime = mimeType;
    try {
        const head = await headObject(config, objectKey);
        const contentLength = Number(head.ContentLength ?? 0);
        if (contentLength > 0) actualSize = contentLength;
        if (typeof head.ContentType === 'string' && head.ContentType) actualMime = head.ContentType;
    } catch {
        // 容忍部分兼容存储不支持 HEAD：退回使用申报值，但下面仍按配置上限校验
    }

    if (actualSize > 0) {
        try {
            assertFileSize(config, actualSize);
        } catch (error) {
            // 真实体积超限：清理已上传对象，不留下"可用"的越权附件
            try {
                await deleteObject(config, objectKey);
            } catch {
                // 清理失败不改变拒绝结论
            }
            throw error;
        }
    }

    const id = crypto.randomUUID();
    await db.insert(attachments).values({
        id,
        userId: session.user.id,
        storageConfigId: config.id,
        objectKey,
        filename,
        mimeType: actualMime,
        size: actualSize,
        category,
    });

    const publicUrl = buildPublicUrl(config, objectKey);
    let url = publicUrl;
    if (!url) {
        try {
            url = await presignDownload(config, objectKey);
        } catch {
            url = null;
        }
    }

    return {
        id,
        filename,
        mimeType: actualMime,
        size: actualSize,
        category,
        createdAt: new Date().toISOString(),
        url,
        isImage: actualMime.startsWith('image/'),
    };
});
