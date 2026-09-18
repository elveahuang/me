import { desc, eq, sql } from 'drizzle-orm';
import { attachments, storageConfigs } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { invalidateStorageConfigCache, sanitizeStorageConfig } from '../../utils/storage';

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

function normalizeEndpoint(raw: unknown): string {
    const value = String(raw ?? '').trim();
    if (!value) {
        throw createError({ statusCode: 400, statusMessage: 'endpoint 必填（如 http://127.0.0.1:9000）' });
    }
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'endpoint 不是合法 URL' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw createError({ statusCode: 400, statusMessage: 'endpoint 仅允许 http/https 协议' });
    }
    return value.replace(/\/+$/, '');
}

/** 把请求体归一化为可写入数据库的字段集合（不含密钥处理） */
function buildPatch(body: Record<string, unknown>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
        if (body[key] === undefined) continue;
        if (key === 'endpoint') {
            patch.endpoint = normalizeEndpoint(body.endpoint);
            continue;
        }
        if (key === 'prefix') {
            patch.prefix = String(body.prefix ?? '').replace(/^\/+|\/+$/g, '') || 'uploads';
            continue;
        }
        patch[key] = body[key] === null ? '' : String(body[key]);
    }
    for (const key of BOOLEAN_FIELDS) {
        if (body[key] !== undefined) patch[key] = Boolean(body[key]);
    }
    if (body.allowedMimeTypes !== undefined) {
        patch.allowedMimeTypes = Array.isArray(body.allowedMimeTypes) ? body.allowedMimeTypes.map((v: unknown) => String(v)).filter(Boolean) : [];
    }
    if (body.maxFileSizeMb !== undefined) {
        const size = Number(body.maxFileSizeMb);
        patch.maxFileSizeMb = Number.isFinite(size) && size > 0 ? Math.min(Math.round(size), 2048) : 20;
    }
    if (typeof body.secretAccessKey === 'string' && body.secretAccessKey && body.secretAccessKey !== SECRET_PLACEHOLDER) {
        patch.secretAccessKey = body.secretAccessKey;
    }
    return patch;
}

/** 保证同一时刻只有一个默认存储 */
/**
 * 切换默认存储。
 *
 * 必须同事务执行两条 update：否则在「已清空旧默认、尚未标记新默认」之间失败，
 * 系统会处于一个默认存储都没有的状态，附件上传随即失败且管理端看不出原因。
 */
async function applyDefault(id: string) {
    await db.transaction(async (tx) => {
        await tx.update(storageConfigs).set({ isDefault: false, updatedAt: new Date() }).where(eq(storageConfigs.isDefault, true));
        await tx.update(storageConfigs).set({ isDefault: true, updatedAt: new Date() }).where(eq(storageConfigs.id, id));
    });
    invalidateStorageConfigCache();
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = (await readBody(event)) ?? {};
        const patch = buildPatch(body ?? {});
        const name = String(patch.name ?? '').trim();
        const bucket = String(patch.bucket ?? '').trim();
        if (!name) throw createError({ statusCode: 400, statusMessage: 'name 必填' });
        if (!bucket) throw createError({ statusCode: 400, statusMessage: 'bucket 必填' });
        if (!patch.endpoint) throw createError({ statusCode: 400, statusMessage: 'endpoint 必填' });

        const id = crypto.randomUUID();
        await db.insert(storageConfigs).values({
            id,
            name,
            provider: String(patch.provider ?? 's3') || 's3',
            endpoint: String(patch.endpoint),
            region: String(patch.region ?? 'us-east-1') || 'us-east-1',
            bucket,
            accessKeyId: String(patch.accessKeyId ?? ''),
            secretAccessKey: String(patch.secretAccessKey ?? ''),
            forcePathStyle: patch.forcePathStyle === undefined ? true : Boolean(patch.forcePathStyle),
            publicBaseUrl: String(patch.publicBaseUrl ?? ''),
            prefix: String(patch.prefix ?? 'uploads') || 'uploads',
            maxFileSizeMb: Number(patch.maxFileSizeMb ?? 20),
            allowedMimeTypes: (patch.allowedMimeTypes as string[]) ?? [],
            enabled: patch.enabled === undefined ? true : Boolean(patch.enabled),
            isDefault: Boolean(patch.isDefault),
        });
        if (patch.isDefault) await applyDefault(id);
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
