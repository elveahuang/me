import { and, eq } from 'drizzle-orm';
import { attachments } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireUser } from '../../../utils/guard';
import { buildPublicUrl, presignDownload, resolveStoredStorageConfig } from '../../../utils/storage';

/**
 * 重新签发访问地址（私有桶预签名 URL 有有效期，前端过期后可再次获取）。
 *
 * 下载语义（?download=1）优先返回**站内下载代理**：
 * 公开桶的公共地址无法强制 Content-Disposition（浏览器只会打开文件而不是下载），
 * 只有走 /raw 才能保证"点下载就下载"。
 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    const id = getRouterParam(event, 'id')!;
    const query = getQuery(event);
    const download = query.download === '1' || query.download === 'true';

    const [row] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, id), eq(attachments.userId, session.user.id)));
    if (!row) {
        throw createError({ statusCode: 404, statusMessage: '附件不存在' });
    }

    const config = await resolveStoredStorageConfig(row.storageConfigId);

    if (download) {
        const publicUrl = buildPublicUrl(config, row.objectKey);
        // 公开桶：公共地址无法强制下载，改用站内代理（它会带 Content-Disposition）
        if (publicUrl) {
            return { url: `/api/attachments/${row.id}/raw`, expiresIn: null, filename: row.filename };
        }
        return { url: await presignOr502(config, row.objectKey, row.filename), expiresIn: 3600, filename: row.filename };
    }

    const url = buildPublicUrl(config, row.objectKey) || (await presignOr502(config, row.objectKey));
    return { url, expiresIn: 3600, filename: row.filename };
});

/** presignDownload 只在本地签名，但缺失密钥的配置会抛 CredentialsProviderError；脱敏成 502，避免把 SDK 细节透给前端 */
async function presignOr502(config: Awaited<ReturnType<typeof resolveStoredStorageConfig>>, key: string, filename?: string): Promise<string> {
    try {
        return await presignDownload(config, key, filename ? { filename } : {});
    } catch {
        throw createError({ statusCode: 502, statusMessage: '暂时无法生成访问地址，请稍后重试' });
    }
}
