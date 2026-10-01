import { eq } from 'drizzle-orm';
import { storageConfigs } from '../../../../db/schema';
import { normalizeAdminBoolean } from '../../../../utils/admin-boolean';
import { db } from '../../../../utils/db';
import { requireAdmin } from '../../../../utils/guard';
import { normalizeStorageEndpoint, testStorageConnection } from '../../../../utils/storage';

/**
 * 存储连接自检。
 * 请求体可携带未保存的表单值（endpoint / bucket / key 等）：先按提交值测试，方便保存前验证。
 * 密钥缺失时回退到数据库中已保存的值。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const body = (await readBody(event)) ?? {};

    const [row] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '存储配置不存在' });

    const candidate = {
        ...row,
        // 未保存的表单值同样要过保存路径的 endpoint 校验；空串不再静默回退到库里的旧地址
        endpoint: body.endpoint !== undefined ? normalizeStorageEndpoint(body.endpoint) : row.endpoint,
        region: body.region ? String(body.region) : row.region,
        bucket: body.bucket ? String(body.bucket) : row.bucket,
        accessKeyId: body.accessKeyId ? String(body.accessKeyId) : row.accessKeyId,
        secretAccessKey: body.secretAccessKey && body.secretAccessKey !== '********' ? String(body.secretAccessKey) : row.secretAccessKey,
        forcePathStyle: normalizeAdminBoolean(body.forcePathStyle, 'forcePathStyle', row.forcePathStyle),
    };

    if (!candidate.accessKeyId || !candidate.secretAccessKey) {
        return { ok: false, message: '缺少 Access Key / Secret Key，无法测试连接' };
    }

    const result = await testStorageConnection(candidate);
    return result;
});
