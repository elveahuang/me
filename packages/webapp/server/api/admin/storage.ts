import { desc, eq, sql } from 'drizzle-orm';
import { attachments, storageConfigs } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { requireMethod } from '../../utils/method';
import { invalidateStorageConfigCache, MAX_FILE_SIZE_MB_LIMIT, normalizeStorageEndpoint, sanitizeStorageConfig } from '../../utils/storage';

/**
 * 存储配置（管理端）。
 *
 * 安全约定：
 * - GET 返回的任何字段都经过 sanitizeStorageConfig()，不返回 secretAccessKey
 * - PATCH 时若 secretAccessKey 未传或为掩码占位符，保留原值（避免"编辑后密钥被清空"）
 * - isDefault 设为 true 时自动取消其他配置的默认标记（全局唯一）
 */

const EDITABLE_FIELDS = ['name', 'provider', 'endpoint', 'region', 'bucket', 'accessKeyId', 'publicBaseUrl', 'prefix'] as const;
const BOOLEAN_FIELDS = ['forcePathStyle', 'enabled', 'isDefault'] as const;

/** 掩码占位符：前端原样回传时表示"不修改密钥" */
const SECRET_PLACEHOLDER = '********';

/** 把请求体归一化为可写入数据库的字段集合（不含密钥处理） */
function buildPatch(body: Record<string, unknown>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
        if (body[key] === undefined) continue;
        if (key === 'endpoint') {
            patch.endpoint = normalizeStorageEndpoint(body.endpoint);
            continue;
        }
        if (key === 'prefix') {
            patch.prefix = String(body.prefix ?? '').replace(/^\/+|\/+$/g, '') || 'uploads';
            continue;
        }
        patch[key] = body[key] === null ? '' : String(body[key]);
    }
    for (const key of BOOLEAN_FIELDS) {
        if (body[key] !== undefined) patch[key] = normalizeAdminBoolean(body[key], key, false);
    }
    if (body.allowedMimeTypes !== undefined) {
        patch.allowedMimeTypes = Array.isArray(body.allowedMimeTypes) ? body.allowedMimeTypes.map((v: unknown) => String(v)).filter(Boolean) : [];
    }
    if (body.maxFileSizeMb !== undefined) {
        const size = Number(body.maxFileSizeMb);
        patch.maxFileSizeMb = Number.isFinite(size) && size > 0 ? Math.min(Math.round(size), MAX_FILE_SIZE_MB_LIMIT) : 20;
    }
    if (typeof body.secretAccessKey === 'string' && body.secretAccessKey && body.secretAccessKey !== SECRET_PLACEHOLDER) {
        patch.secretAccessKey = body.secretAccessKey;
    }
    return patch;
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    // 其余方法（PUT/PATCH/DELETE）原本落进下面的读取分支：请求拿到 200 + 列表，看起来像写成功了
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        const patch = buildPatch(body ?? {});
        const name = String(patch.name ?? '').trim();
        const bucket = String(patch.bucket ?? '').trim();
        if (!name) throw createError({ statusCode: 400, statusMessage: 'name 必填' });
        if (!bucket) throw createError({ statusCode: 400, statusMessage: 'bucket 必填' });
        if (!patch.endpoint) throw createError({ statusCode: 400, statusMessage: 'endpoint 必填' });

        const id = crypto.randomUUID();
        const isDefault = patch.isDefault === true;
        const values = {
            id,
            name,
            provider: String(patch.provider ?? 's3') || 's3',
            endpoint: String(patch.endpoint),
            region: String(patch.region ?? 'us-east-1') || 'us-east-1',
            bucket,
            accessKeyId: String(patch.accessKeyId ?? ''),
            secretAccessKey: String(patch.secretAccessKey ?? ''),
            forcePathStyle: (patch.forcePathStyle as boolean | undefined) ?? true,
            publicBaseUrl: String(patch.publicBaseUrl ?? ''),
            prefix: String(patch.prefix ?? 'uploads') || 'uploads',
            maxFileSizeMb: Number(patch.maxFileSizeMb ?? 20),
            allowedMimeTypes: (patch.allowedMimeTypes as string[]) ?? [],
            enabled: (patch.enabled as boolean | undefined) ?? true,
            isDefault,
        };

        // 清空旧默认与插入新默认必须同事务：分两步写时若在中间失败，库里会同时存在两份默认配置
        await db.transaction(async (tx) => {
            if (isDefault) await tx.update(storageConfigs).set({ isDefault: false, updatedAt: new Date() }).where(eq(storageConfigs.isDefault, true));
            await tx.insert(storageConfigs).values(values);
        });
        invalidateStorageConfigCache();
        const [row] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, id));
        if (!row) throw createError({ statusCode: 500, statusMessage: '存储配置创建失败' });
        return sanitizeStorageConfig(row);
    }

    const rows = await db.select().from(storageConfigs).orderBy(desc(storageConfigs.isDefault), desc(storageConfigs.createdAt));

    /**
     * 每个存储下的附件数量与占用：单次聚合查询，避免逐个配置查表（N+1）。
     * 管理端据此判断哪份配置在用、是否已有历史附件（有引用时不可删除）。
     */
    const usage = await db
        .select({
            storageConfigId: attachments.storageConfigId,
            count: sql<number>`count(*)::int`,
            bytes: sql<number>`coalesce(sum(${attachments.size}), 0)::bigint`,
        })
        .from(attachments)
        .groupBy(attachments.storageConfigId);
    const usageMap = new Map(usage.map((row) => [row.storageConfigId ?? '', { count: row.count, bytes: Number(row.bytes) }]));

    return rows.map((row) => ({
        ...sanitizeStorageConfig(row),
        attachmentCount: usageMap.get(row.id)?.count ?? 0,
        attachmentBytes: usageMap.get(row.id)?.bytes ?? 0,
    }));
});
