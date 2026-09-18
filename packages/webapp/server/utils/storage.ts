import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { desc, eq } from 'drizzle-orm';
import { storageConfigs, type StorageConfig } from '../db/schema';
import { db } from './db';

/**
 * 对象存储（S3 协议）适配层。
 *
 * 面向 RustFS / MinIO / AWS S3 / 阿里云 OSS 等所有兼容 S3 的服务：
 * - 自建存储在反向代理下通常只有 path-style（`http://host/bucket/key`）可用，因此默认开启
 * - 私有桶通过预签名 URL 授权访问；配置了 publicBaseUrl 时优先返回公共地址（不泄露签名）
 * - 密钥字段只在服务端使用，任何返回给前端的配置都必须经过 sanitizeStorageConfig()
 */

/** 未配置 publicBaseUrl 时，预签名下载 URL 的有效期（秒） */
const DEFAULT_PRESIGN_EXPIRES = 3600;

/** 默认存储的配置缓存，避免列表接口每条附件都查一次库 */
let defaultConfigCache: { value: StorageConfig | null; at: number } | null = null;
const CONFIG_CACHE_TTL = 10_000;

export function invalidateStorageConfigCache() {
    defaultConfigCache = null;
}

/** 取默认（或指定）存储配置；enabled=false 的配置不可用于新上传 */
export async function resolveStorageConfig(preferredId?: string | null): Promise<StorageConfig> {
    if (preferredId) {
        const [row] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, preferredId));
        if (row && row.enabled) return row;
    }
    if (defaultConfigCache && Date.now() - defaultConfigCache.at < CONFIG_CACHE_TTL) {
        if (defaultConfigCache.value) return defaultConfigCache.value;
    }
    const rows = await db
        .select()
        .from(storageConfigs)
        .where(eq(storageConfigs.enabled, true))
        .orderBy(desc(storageConfigs.isDefault), desc(storageConfigs.createdAt));
    const value = rows[0] ?? null;
    defaultConfigCache = { value, at: Date.now() };
    if (!value) {
        throw createError({ statusCode: 503, statusMessage: '尚未配置对象存储，请联系管理员在管理后台「存储配置」中添加' });
    }
    return value;
}

/**
 * 解析「已存在附件」所属的存储配置（读取 / 下载 / 删除历史对象时用）。
 *
 * 与 resolveStorageConfig 的关键区别：**不回退到默认配置**。
 * resolveStorageConfig 面向新上传，传入的 preferredId 缺失或禁用时回退默认是合理的；
 * 但对一个 objectKey 已落库的附件，若它原来的配置被删/禁用，回退默认会
 * 用另一个桶去读取或删除同名 key——即读错/删错对象。这里改为按 id 严格解析：
 * 配置必须存在（不要求 enabled，否则禁用配置会把历史对象永久孤立），否则抛错。
 */
export async function resolveStoredStorageConfig(storageConfigId: string | null | undefined): Promise<StorageConfig> {
    if (!storageConfigId) {
        throw createError({ statusCode: 503, statusMessage: '该附件缺少存储配置信息，无法访问' });
    }
    const [row] = await db.select().from(storageConfigs).where(eq(storageConfigs.id, storageConfigId));
    if (!row) {
        throw createError({ statusCode: 503, statusMessage: '附件所属的存储配置已被删除，无法访问' });
    }
    return row;
}

/** 内部哨兵 key：表示 storageConfigId 为空（历史数据），映射到默认配置 */
const DEFAULT_CONFIG_KEY = '';

/**
 * 为一批对象（按各自的 storageConfigId）解析其存储配置，供列表/批量签发使用。
 *
 * 历史附件可能分属不同存储配置，用「当前默认配置」给全部行签名会把非默认桶的对象签成错误
 * 地址（读错桶）。这里按 id 去重后各解析一次：非空 id 走严格解析（不回退），空 id 回退默认，
 * 解析失败的项映射为 null——调用方据此把该行 URL 置空，而不是让整批请求失败。
 */
export async function resolveStorageConfigMap(ids: Array<string | null | undefined>): Promise<Map<string, StorageConfig | null>> {
    const keys = [...new Set(ids.map((id) => id ?? DEFAULT_CONFIG_KEY))];
    const entries = await Promise.all(
        keys.map(async (key): Promise<[string, StorageConfig | null]> => {
            try {
                if (key === DEFAULT_CONFIG_KEY) return [key, await resolveStorageConfig(null)];
                return [key, await resolveStoredStorageConfig(key)];
            } catch {
                return [key, null];
            }
        }),
    );
    return new Map(entries);
}

/** 从 resolveStorageConfigMap 的结果里按行的 storageConfigId 取配置 */
export function pickStorageConfig(map: Map<string, StorageConfig | null>, id: string | null | undefined): StorageConfig | null {
    return map.get(id ?? DEFAULT_CONFIG_KEY) ?? null;
}

/**
 * 归一化附件分类：只保留 `[a-z0-9_-]`，其余丢弃，空则回退 `other`。
 * category 会作为对象 key 的一个路径段写进桶里，也是列表筛选/统计的分组键，
 * 因此必须在进入 key 之前去掉 `/`、`\`、`..`、换行等字符，防止污染对象路径。
 */
export function normalizeAttachmentCategory(value: unknown): string {
    const cleaned = (typeof value === 'string' ? value : '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
    return cleaned.slice(0, 32) || 'other';
}

export function createS3Client(config: StorageConfig): S3Client {
    return new S3Client({
        endpoint: config.endpoint,
        region: config.region || 'us-east-1',
        forcePathStyle: config.forcePathStyle,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
        // 部分自建网关（RustFS 前面的反代）不支持校验和流式签名，保持与通用 S3 客户端一致的行为
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
    });
}

/** 生成对象 key：`{prefix}/{category}/{yyyy}/{mm}/{uuid}-{安全文件名}` */
export function buildObjectKey(config: Pick<StorageConfig, 'prefix'>, filename: string, category = 'other'): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const prefix = (config.prefix || 'uploads').replace(/^\/+|\/+$/g, '');
    const safeName = sanitizeFilename(filename);
    const safeCategory = normalizeAttachmentCategory(category);
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${prefix}/${safeCategory}/${year}/${month}/${day}/${crypto.randomUUID()}-${safeName}`;
}

/**
 * 清洗文件名：去掉路径分隔符与控制字符，保留扩展名。
 * 防目录穿越（../）与对象 key 污染，同时保证中文名可用。
 */
export function sanitizeFilename(filename: string): string {
    const base = (filename || 'file').split(/[\\/]/).pop() ?? 'file';
    const cleaned = base
        .replace(/[\u0000-\u001f\u007f"]/g, '')
        .replace(/\.{2,}/g, '.')
        .trim();
    const safe = cleaned.replace(/[^\w\u4e00-\u9fa5.\-()（）\s]/g, '_');
    return safe.slice(0, 120) || 'file';
}

/** 拼接公共访问地址（仅当配置了 publicBaseUrl） */
export function buildPublicUrl(config: Pick<StorageConfig, 'publicBaseUrl' | 'endpoint' | 'bucket' | 'forcePathStyle'>, key: string): string | null {
    if (!config.publicBaseUrl) return null;
    const base = config.publicBaseUrl.replace(/\/+$/, '');
    return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * 预签名上传地址（PUT 语义，供前端直传大文件）。
 *
 * 安全边界：S3 的 PUT 预签名 URL **无法**携带 content-length-range 条件
 * （那是 POST policy 的能力），所以这里签发的地址本身不限制体积。
 * 上限由两步兜底保证：
 *   1. 登记时 `/api/attachments/complete` 会 HeadObject 读真实大小并比对配置上限；
 *   2. 超限的对象会被立即删除并拒绝登记。
 * 因此 attacker 即使直传了超大对象，也无法把它变成可用附件或长期占用配额。
 */
export async function presignUpload(config: StorageConfig, key: string, mimeType: string, expiresIn = 900): Promise<string> {
    const client = createS3Client(config);
    return getSignedUrl(
        client,
        new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            ContentType: mimeType || 'application/octet-stream',
        }),
        { expiresIn },
    );
}

export interface PresignedPost {
    url: string;
    fields: Record<string, string>;
    maxBytes: number;
    expiresIn: number;
}

/**
 * 生成带体积上限的预签名直传表单（presigned POST）。
 *
 * 相比 PUT 预签名 URL，POST policy 可携带 `content-length-range` 条件，
 * 由对象存储**在写入前**强制拒绝超限上传，适合希望完全避免超大对象落盘的场景。
 */
export async function presignUploadPolicy(config: StorageConfig, key: string, mimeType: string, expiresIn = 900): Promise<PresignedPost> {
    const client = createS3Client(config);
    const maxBytes = relayLimitBytes(config.maxFileSizeMb);
    const { createPresignedPost } = await import('@aws-sdk/s3-presigned-post');
    const post = await createPresignedPost(client, {
        Bucket: config.bucket,
        Key: key,
        Expires: expiresIn,
        Fields: { 'Content-Type': mimeType || 'application/octet-stream' },
        Conditions: [['content-length-range', 1, maxBytes], { 'Content-Type': mimeType || 'application/octet-stream' }],
    });
    return { url: post.url, fields: post.fields, maxBytes, expiresIn };
}

/** 读取对象元数据（直传登记时校验真实大小用） */
export async function headObject(config: StorageConfig, key: string) {
    const client = createS3Client(config);
    return client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
}

/** 预签名下载地址；配置了 publicBaseUrl 时直接返回公共地址 */
export async function presignDownload(config: StorageConfig, key: string, options: { filename?: string; expiresIn?: number } = {}): Promise<string> {
    const publicUrl = buildPublicUrl(config, key);
    if (publicUrl) return publicUrl;
    const client = createS3Client(config);
    const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ...(options.filename ? { ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(options.filename)}` } : {}),
    });
    return getSignedUrl(client, command, { expiresIn: options.expiresIn ?? DEFAULT_PRESIGN_EXPIRES });
}

/** 服务端直传（小文件 / 前端无法直连对象存储时的兜底通道） */
export async function putObject(config: StorageConfig, key: string, body: Uint8Array, mimeType: string): Promise<void> {
    const client = createS3Client(config);
    await client.send(
        new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ContentType: mimeType || 'application/octet-stream',
            ContentLength: body.byteLength,
        }),
    );
}

/** 服务端读取对象（私有桶下载代理用） */
export async function getObject(config: StorageConfig, key: string) {
    const client = createS3Client(config);
    return client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
}

export async function deleteObject(config: StorageConfig, key: string): Promise<void> {
    const client = createS3Client(config);
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

export interface StorageTestResult {
    ok: boolean;
    message: string;
    latencyMs?: number;
}

/** 连接自检：HeadBucket + ListObjectsV2（各 1 次请求），返回可读结果而不是抛异常 */
export async function testStorageConnection(config: StorageConfig): Promise<StorageTestResult> {
    const started = Date.now();
    try {
        const client = createS3Client(config);
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
        await client.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }));
        return { ok: true, message: `连接成功，存储桶 ${config.bucket} 可读写`, latencyMs: Date.now() - started };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, message: `连接失败：${detail}`, latencyMs: Date.now() - started };
    }
}

/** 接口返回前脱敏：不暴露 secret，仅暴露"是否已配置密钥" */
export function sanitizeStorageConfig(row: StorageConfig) {
    const { accessKeyId, secretAccessKey, ...rest } = row;
    return {
        ...rest,
        accessKeyIdPreview: accessKeyId ? `${accessKeyId.slice(0, 4)}****` : '',
        hasCredentials: Boolean(accessKeyId && secretAccessKey),
    };
}

export type SanitizedStorageConfig = ReturnType<typeof sanitizeStorageConfig>;

/** 允许的 MIME 前缀校验；列表为空表示不限制 */
export function isMimeAllowed(config: Pick<StorageConfig, 'allowedMimeTypes'>, mimeType: string): boolean {
    const allowed = config.allowedMimeTypes ?? [];
    if (!allowed.length) return true;
    return allowed.some((rule) => (rule.endsWith('/') ? mimeType.startsWith(rule) : mimeType === rule));
}

export function assertFileSize(config: Pick<StorageConfig, 'maxFileSizeMb'>, size: number) {
    const limit = (config.maxFileSizeMb || 20) * 1024 * 1024;
    if (size > limit) {
        throw createError({ statusCode: 400, statusMessage: `文件超过 ${config.maxFileSizeMb}MB 限制` });
    }
}

/**
 * 服务端中转上传的硬上限。
 *
 * readMultipartFormData() 会把整个请求体读进内存，因此必须在解析前依据
 * Content-Length 拒绝超大请求，否则单次上传就可能耗尽 Node 进程内存。
 * 超过该上限的文件应走预签名直传（浏览器 → 对象存储，不经过 Node）。
 */
export const RELAY_UPLOAD_HARD_LIMIT_MB = 64;

/** multipart 边界、字段名、CRLF 等协议开销的宽容量 */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** 中转上传的实际上限：取配置值与硬上限中的较小者 */
export function relayLimitBytes(maxFileSizeMb: number | null | undefined): number {
    return Math.min(maxFileSizeMb || 20, RELAY_UPLOAD_HARD_LIMIT_MB) * 1024 * 1024;
}

/**
 * 读取请求体之前的前置校验。
 * 依据 Content-Length 提前拒绝超大请求，避免把整个请求体读入内存。
 */
export function assertRelayRequestAllowed(contentLength: unknown, maxFileSizeMb: number | null | undefined): void {
    const limit = relayLimitBytes(maxFileSizeMb);
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > limit + MULTIPART_OVERHEAD_BYTES) {
        // 413 而非 400：语义上是「请求体过大」，前端可据此提示改用直传
        throw createError({
            statusCode: 413,
            statusMessage: `文件超过 ${Math.round(limit / 1024 / 1024)}MB 限制，请压缩后重试或改用直传`,
        });
    }
}

/**
 * 解析 multipart 后再次校验实际字节数。
 * 兼容未携带 Content-Length 的 chunked 请求，也防止伪造长度绕过前置校验。
 */
export function assertRelayPayloadSize(actualBytes: number, maxFileSizeMb: number | null | undefined): void {
    const limit = relayLimitBytes(maxFileSizeMb);
    if (actualBytes > limit) {
        throw createError({
            statusCode: 413,
            statusMessage: `文件超过 ${Math.round(limit / 1024 / 1024)}MB 限制，请压缩后重试或改用直传`,
        });
    }
}

export { DEFAULT_PRESIGN_EXPIRES };
