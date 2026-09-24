import { requireUser } from '../../utils/guard';
import { readCappedJsonBody } from '../../utils/request-body';
import {
    assertFileSize,
    buildObjectKey,
    isMimeAllowed,
    normalizeAttachmentCategory,
    normalizeMimeType,
    presignUpload,
    presignUploadPolicy,
    resolveStorageConfig,
    sanitizeFilename,
} from '../../utils/storage';

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
    // 本端点没有按次限流：一条没有 Content-Length 的 chunked 大请求就会被 readBody 完整缓冲，
    // 体积闸门必须落在实际字节上（readCappedJsonBody 越限即丢缓冲并把流读干后回 413）
    const body: Record<string, unknown> = (await readCappedJsonBody<Record<string, unknown>>(event)) ?? {};
    const filename = sanitizeFilename(String(body?.filename ?? 'file'));
    const mimeType = normalizeMimeType(body?.mimeType);
    const category = normalizeAttachmentCategory(body?.category);
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
