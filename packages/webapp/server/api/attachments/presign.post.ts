import { requireUser } from '../../utils/guard';
import { assertFileSize, buildObjectKey, isMimeAllowed, presignUpload, resolveStorageConfig, sanitizeFilename } from '../../utils/storage';

/**
 * 获取对象存储预签名上传地址（前端直传通道）。
 * 适用于已给桶配好 CORS 的场景；未配 CORS 时请改用 POST /api/attachments 服务端中转。
 */
export default defineEventHandler(async (event) => {
    await requireUser(event);
    const body = await readBody(event);
    const filename = sanitizeFilename(body?.filename || 'file');
    const mimeType = typeof body?.mimeType === 'string' && body.mimeType ? body.mimeType : 'application/octet-stream';
    const category = typeof body?.category === 'string' && body.category ? body.category : 'other';
    const size = Number(body?.size) || 0;

    const config = await resolveStorageConfig(null);
    if (size > 0) assertFileSize(config, size);
    if (!isMimeAllowed(config, mimeType)) {
        throw createError({ statusCode: 400, statusMessage: `该存储不允许上传 ${mimeType} 类型文件` });
    }

    const objectKey = buildObjectKey(config, filename, category);
    const uploadUrl = await presignUpload(config, objectKey, mimeType);
    return { uploadUrl, objectKey, expiresIn: 900, maxFileSizeMb: config.maxFileSizeMb };
});
