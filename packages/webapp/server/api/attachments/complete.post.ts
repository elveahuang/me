import { attachments } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';
import { assertFileSize, buildPublicUrl, isMimeAllowed, presignDownload, resolveStorageConfig, sanitizeFilename } from '../../utils/storage';

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
    const category = typeof body.category === 'string' && body.category ? body.category : 'other';

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

    const id = crypto.randomUUID();
    await db.insert(attachments).values({
        id,
        userId: session.user.id,
        storageConfigId: config.id,
        objectKey,
        filename,
        mimeType,
        size,
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
        mimeType,
        size,
        category,
        createdAt: new Date().toISOString(),
        url,
        isImage: mimeType.startsWith('image/'),
    };
});
