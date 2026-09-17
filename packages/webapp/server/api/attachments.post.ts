import { attachments } from '../db/schema';
import { db } from '../utils/db';
import { requireUser } from '../utils/guard';
import {
    assertRelayPayloadSize,
    assertRelayRequestAllowed,
    buildObjectKey,
    buildPublicUrl,
    isMimeAllowed,
    presignDownload,
    putObject,
    resolveStorageConfig,
    sanitizeFilename,
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

    // 解析请求体前先按 Content-Length 拦截，避免超大请求被整体读入内存
    const config = await resolveStorageConfig(null);
    assertRelayRequestAllowed(getHeader(event, 'content-length'), config.maxFileSizeMb);

    const parts = (await readMultipartFormData(event)) ?? [];
    const filePart = parts.find((part) => part.name === 'file');
    if (!filePart) {
        throw createError({ statusCode: 400, statusMessage: '缺少 file 字段' });
    }
    const categoryPart = parts.find((part) => part.name === 'category');
    const category = categoryPart ? categoryPart.data.toString('utf-8').trim() || 'other' : 'other';

    const filename = sanitizeFilename(filePart.filename || 'file');
    const mimeType = filePart.type || 'application/octet-stream';
    const size = filePart.data.length;

    // 兜底：伪造 Content-Length 或 chunked 请求在解析后再次校验
    assertRelayPayloadSize(size, config.maxFileSizeMb);
    if (!isMimeAllowed(config, mimeType)) {
        throw createError({ statusCode: 400, statusMessage: `该存储不允许上传 ${mimeType} 类型文件` });
    }
    if (!config.accessKeyId || !config.secretAccessKey) {
        throw createError({ statusCode: 503, statusMessage: '对象存储缺少访问密钥，请在管理后台补全配置' });
    }

    const objectKey = buildObjectKey(config, filename, category);
    try {
        await putObject(config, objectKey, filePart.data, mimeType);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw createError({ statusCode: 502, statusMessage: `对象存储上传失败：${detail}` });
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
