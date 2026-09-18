import { requireUser } from '../../utils/guard';
import { assertFileSize, buildObjectKey, isMimeAllowed, presignUpload, presignUploadPolicy, resolveStorageConfig, sanitizeFilename } from '../../utils/storage';

/**
 * 获取对象存储直传凭据（前端直传通道）。
 * 适用于已给桶配好 CORS 的场景；未配 CORS 时请改用 POST /api/attachments 服务端中转。
 *
 * 两种模式：
 * - 默认（mode=put，兼容旧客户端）：返回 PUT 预签名 URL。PUT 签名无法携带体积条件，
 *   因此体积上限由登记接口 `/api/attachments/complete` 回源 HeadObject 校验并删除超限对象来保证。
 * - mode=post（推荐）：返回预签名 POST 表单，policy 中带 content-length-range，
 *   由对象存储在上传阶段直接拒绝超限，避免超大对象白白落盘。
 */
export default defineEventHandler(async (event) => {
    await requireUser(event);
    const body = (await readBody(event)) ?? {};
    const filename = sanitizeFilename(body?.filename || 'file');
    const mimeType = typeof body?.mimeType === 'string' && body.mimeType ? body.mimeType : 'application/octet-stream';
    const category = typeof body?.category === 'string' && body.category ? body.category : 'other';
    const size = Number(body?.size) || 0;
    const mode = body?.mode === 'post' ? 'post' : 'put';

    const config = await resolveStorageConfig(null);
    if (size > 0) assertFileSize(config, size);
    if (!isMimeAllowed(config, mimeType)) {
        throw createError({ statusCode: 400, statusMessage: `该存储不允许上传 ${mimeType} 类型文件` });
    }

    const objectKey = buildObjectKey(config, filename, category);

    if (mode === 'post') {
        const post = await presignUploadPolicy(config, objectKey, mimeType);
        return { mode: 'post', ...post, objectKey, maxFileSizeMb: config.maxFileSizeMb };
    }

    const uploadUrl = await presignUpload(config, objectKey, mimeType);
    return { mode: 'put', uploadUrl, objectKey, expiresIn: 900, maxFileSizeMb: config.maxFileSizeMb };
});
