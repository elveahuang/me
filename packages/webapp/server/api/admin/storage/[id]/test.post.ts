import { eq } from 'drizzle-orm';
import { storageConfigs } from '../../../../db/schema';
import { db } from '../../../../utils/db';
import { requireAdmin } from '../../../../utils/guard';
import { testStorageConnection } from '../../../../utils/storage';

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
        endpoint: body.endpoint ? String(body.endpoint).replace(/\/+$/, '') : row.endpoint,
        region: body.region ? String(body.region) : row.region,
        bucket: body.bucket ? String(body.bucket) : row.bucket,
        accessKeyId: body.accessKeyId ? String(body.accessKeyId) : row.accessKeyId,
        secretAccessKey: body.secretAccessKey && body.secretAccessKey !== '********' ? String(body.secretAccessKey) : row.secretAccessKey,
        forcePathStyle: body.forcePathStyle === undefined ? row.forcePathStyle : Boolean(body.forcePathStyle),
    };

    if (!candidate.accessKeyId || !candidate.secretAccessKey) {
        return { ok: false, message: '缺少 Access Key / Secret Key，无法测试连接' };
    }

    const result = await testStorageConnection(candidate);
    return result;
});
