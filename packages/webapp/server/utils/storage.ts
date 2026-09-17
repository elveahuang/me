import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${prefix}/${category}/${year}/${month}/${day}/${crypto.randomUUID()}-${safeName}`;
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

/** 预签名上传地址（前端直传，避免大文件穿透 Node 进程） */
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

export { DEFAULT_PRESIGN_EXPIRES };
