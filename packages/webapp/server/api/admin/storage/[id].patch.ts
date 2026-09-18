import { eq, ne } from 'drizzle-orm';
import { storageConfigs } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { invalidateStorageConfigCache, sanitizeStorageConfig } from '../../../utils/storage';

const BOOLEAN_FIELDS = ['forcePathStyle', 'enabled', 'isDefault'] as const;
const STRING_FIELDS = ['name', 'provider', 'region', 'bucket', 'accessKeyId', 'publicBaseUrl', 'prefix'] as const;
const SECRET_PLACEHOLDER = '********';

function normalizeEndpoint(raw: unknown): string {
    const value = String(raw ?? '').trim();
    if (!value) throw createError({ statusCode: 400, statusMessage: 'endpoint 不能为空' });
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

/** 更新存储配置；secretAccessKey 传掩码占位符时保留原值 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const body = (await readBody(event)) ?? {};

    const [existing] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, id));
    if (!existing) throw createError({ statusCode: 404, statusMessage: '存储配置不存在' });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of STRING_FIELDS) {
        if (body[key] !== undefined) {
            const value = body[key] === null ? '' : String(body[key]);
            if (key === 'prefix') patch.prefix = value.replace(/^\/+|\/+$/g, '') || 'uploads';
            else patch[key] = value;
        }
    }
    if (body.endpoint !== undefined) patch.endpoint = normalizeEndpoint(body.endpoint);
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

    if (patch.name !== undefined && !String(patch.name).trim()) {
        throw createError({ statusCode: 400, statusMessage: 'name 不能为空' });
    }
    if (patch.bucket !== undefined && !String(patch.bucket).trim()) {
        throw createError({ statusCode: 400, statusMessage: 'bucket 不能为空' });
    }
    if (!patch.accessKeyId && existing.accessKeyId === '' && body.accessKeyId !== undefined) {
        // 允许清空；仅做提示性校验，不阻塞保存
    }

    // 切换默认存储是「清其它 + 设本条」两步写，必须同事务，否则中途失败会留下零个或两个默认配置。
    // patch 已含 isDefault:true 时，先清掉其它配置的默认位，再写本条即可，无需再对本条重复更新。
    await db.transaction(async (tx) => {
        if (patch.isDefault === true) {
            await tx.update(storageConfigs).set({ isDefault: false, updatedAt: new Date() }).where(ne(storageConfigs.id, id));
        }
        await tx.update(storageConfigs).set(patch).where(eq(storageConfigs.id, id));
    });
    invalidateStorageConfigCache();

    const [row] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '存储配置不存在' });
    return sanitizeStorageConfig(row);
});
