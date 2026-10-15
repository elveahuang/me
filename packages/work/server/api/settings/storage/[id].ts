import { eq, ne } from 'drizzle-orm';
import type { H3Event } from 'h3';
import { attachments, storageConfigs } from '../../../db/schema';
import { normalizeAdminBoolean } from '../../../utils/admin-boolean';
import { normalizeStorageText } from '../../../utils/admin-storage-input';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { stripNull } from '../../../utils/pg-text';
import { flagParam } from '../../../utils/query';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';
import { invalidateStorageConfigCache, MAX_FILE_SIZE_MB_LIMIT, normalizeStorageEndpoint, sanitizeStorageConfig } from '../../../utils/storage';
import { lockDefaultSlot } from '../../../utils/unique-default';

const BOOLEAN_FIELDS = ['forcePathStyle', 'enabled', 'isDefault'] as const;
const STRING_FIELDS = ['name', 'provider', 'region', 'bucket', 'accessKeyId', 'publicBaseUrl', 'prefix'] as const;
const SECRET_PLACEHOLDER = '********';

/** 更新存储配置；secretAccessKey 传掩码占位符时保留原值 */
async function patchStorageConfig(event: H3Event, id: string) {
    const body = (await readBody(event)) ?? {};

    const [existing] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, id));
    if (!existing) throw createError({ statusCode: 404, statusMessage: '存储配置不存在' });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of STRING_FIELDS) {
        if (body[key] !== undefined) {
            // 与 POST 的 buildPatch 同一口径：非字符串不再被 String() 折成 '[object Object]' 静默落库
            const value = normalizeStorageText(body[key], key);
            if (key === 'prefix') patch.prefix = value.replace(/^\/+|\/+$/g, '') || 'uploads';
            else patch[key] = value;
        }
    }
    if (body.endpoint !== undefined) patch.endpoint = normalizeStorageEndpoint(body.endpoint);
    for (const key of BOOLEAN_FIELDS) {
        if (body[key] !== undefined) patch[key] = normalizeAdminBoolean(body[key], key, false);
    }
    if (body.allowedMimeTypes !== undefined) {
        patch.allowedMimeTypes = Array.isArray(body.allowedMimeTypes) ? body.allowedMimeTypes.map((v: unknown) => stripNull(String(v))).filter(Boolean) : [];
    }
    if (body.maxFileSizeMb !== undefined) {
        const size = Number(body.maxFileSizeMb);
        patch.maxFileSizeMb = Number.isFinite(size) && size > 0 ? Math.min(Math.round(size), MAX_FILE_SIZE_MB_LIMIT) : 20;
    }
    if (typeof body.secretAccessKey === 'string' && body.secretAccessKey && body.secretAccessKey !== SECRET_PLACEHOLDER) {
        patch.secretAccessKey = stripNull(body.secretAccessKey);
    }

    if (patch.name !== undefined && !String(patch.name).trim()) {
        throw createError({ statusCode: 400, statusMessage: 'name 不能为空' });
    }
    if (patch.bucket !== undefined && !String(patch.bucket).trim()) {
        throw createError({ statusCode: 400, statusMessage: 'bucket 不能为空' });
    }

    // 切换默认存储是「清其它 + 设本条」两步写，必须同事务，否则中途失败会留下零个或两个默认配置。
    // patch 已含 isDefault:true 时，先清掉其它配置的默认位，再写本条即可，无需再对本条重复更新。
    // 槽位锁补的是并发那一半：另一笔「设为默认」（同页兄弟请求或 POST 新建）看不到本笔尚未提交的行，
    // 两边互不清除对方 → 两个默认存储，附件按默认位选桶时就会随机落错。见 utils/unique-default.ts。
    await db.transaction(async (tx) => {
        if (patch.isDefault === true) {
            await lockDefaultSlot(tx, 'storage');
            await tx.update(storageConfigs).set({ isDefault: false, updatedAt: new Date() }).where(ne(storageConfigs.id, id));
        }
        await tx.update(storageConfigs).set(patch).where(eq(storageConfigs.id, id));
    });
    invalidateStorageConfigCache();

    const [row] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '存储配置不存在' });
    return sanitizeStorageConfig(row);
}

/**
 * 存储配置详情 / 更新 / 删除。
 * DELETE 前先统计引用该配置的附件数量：有引用时阻止删除（避免出现无法访问的孤儿附件），
 * 除非显式传 `?force=1`（此时附件记录保留但 storageConfigId 置空，只能手工清理）。
 */
export default defineEventHandler(async (event) => {
    const method = requireMethod(event, ['GET', 'PATCH', 'DELETE']);
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    const id = routeId(event, 'id', '存储配置');

    if (method === 'DELETE') {
        const force = flagParam(getQuery(event).force);
        // 「读这行 → 查引用 → 删除」必须在一个事务里，且开头那步要锁住待删行，否则两次检查都是过去式：
        // - 并发上传刚把 storageConfigId 指过来，删除就把它 SET NULL 成一条不知道自己原本属于哪个桶的记录
        //   （attachments.storage_config_id 是 onDelete: 'set null'，PG 不会替我们拦住）；
        // - 另一个管理员刚把它设为默认（`admin/storage.ts` 的「清掉其它默认 + 设自己为默认」就是这套事务），
        //   删完系统就没有默认存储了。
        // 行上的 FOR UPDATE 与这些写入在父行上取的 FK 锁互斥，窗口因此关死（新写入要么先被查到，要么排到删除之后）。
        await db.transaction(async (tx) => {
            const [locked] = await tx.select().from(storageConfigs).where(eq(storageConfigs.id, id)).for('update');
            if (!locked) throw createError({ statusCode: 404, statusMessage: '存储配置不存在' });

            const used = await tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.storageConfigId, id)).limit(1);
            if (used.length && !force) {
                throw createError({ statusCode: 409, statusMessage: '该存储下仍有附件，请先清理附件或使用强制删除' });
            }
            if (locked.isDefault) {
                throw createError({ statusCode: 409, statusMessage: '默认存储不可删除，请先将其他配置设为默认' });
            }
            await tx.delete(storageConfigs).where(eq(storageConfigs.id, id));
        });
        invalidateStorageConfigCache();
        return { ok: true };
    }

    if (method === 'PATCH') return patchStorageConfig(event, id);

    const [row] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '存储配置不存在' });

    return sanitizeStorageConfig(row);
});
