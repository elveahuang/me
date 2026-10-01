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
import { and, desc, eq, sql } from 'drizzle-orm';
import { attachments, storageConfigs, type StorageConfig } from '../db/schema';
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

/**
 * 归一化客户端申报的 mimeType：截到 128 字符并拒绝控制字符，非法即回退缺省值。
 * 三条上传通道（中转/直传登记/presign）都把它写进 text 列；
 * 桶未配置 allowedMimeTypes 时 isMimeAllowed 全放行，长度只能在这里兜住。
 */
export function normalizeMimeType(value: unknown, fallback = 'application/octet-stream'): string {
    const cleaned = (typeof value === 'string' ? value : '').trim().slice(0, 128);
    return cleaned && !/[\u0000-\u001f\u007f]/.test(cleaned) ? cleaned : fallback;
}

/**
 * 存储 endpoint 归一：保存（POST/PATCH）与连接自检共用一份校验。
 * test 通道原本只做去尾斜杠，畸形或非 http(s) 的 endpoint 会一路进到 SDK，
 * 最后回一句 `连接失败：Invalid URL`，而不是一个明确的 400。
 */
export function normalizeStorageEndpoint(raw: unknown): string {
    const value = String(raw ?? '').trim();
    if (!value) throw createError({ statusCode: 400, statusMessage: 'endpoint 必填（如 http://127.0.0.1:9000）' });
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

/**
 * 与桶建连的超时（毫秒）。TCP 层卡住（对端端口开着但进程挂死、防火墙 drop）时
 * NodeHttpHandler 只认这个值；不给就是 `socket.connect()` 无超时，请求永久悬挂。
 */
const S3_CONNECTION_TIMEOUT_MS = 5_000;
/** 元数据类调用（Head/List/Delete/取响应头）的响应超时 */
const S3_REQUEST_TIMEOUT_MS = 15_000;
/**
 * 服务端中转写入的响应超时。正文最大 64MB（见 RELAY_UPLOAD_HARD_LIMIT_MB），
 * 传输时间随带宽变化，不能用元数据那档 15s 去掐它。
 */
const S3_UPLOAD_REQUEST_TIMEOUT_MS = 120_000;
/** 重试次数：超时属于可重试错误，默认 3 次会把挂死网关放大成 3 倍等待 */
const S3_MAX_ATTEMPTS = 2;

export interface S3ClientOptions {
    /** 响应超时；只对「等响应」收口，不影响预签名这类纯本地计算 */
    requestTimeoutMs?: number;
    maxAttempts?: number;
}

/**
 * 创建 S3 客户端。**超时必须在这里给**：AWS SDK 的 `requestTimeout` 默认是 0（不超时），
 * 而且客户端顶层的 `requestTimeout`/`connectionTimeout` 根本不会传进默认 handler
 * （生成码是 `NodeHttpHandler.create(config?.requestHandler ?? defaultConfigProvider)`），
 * 只有塞进 `requestHandler` 的构造参数里才生效；另外 `requestTimeout` 单独用只会打 WARN
 * 并继续挂着，必须配 `throwOnRequestTimeout: true` 才真正中断。
 */
export function createS3Client(config: StorageConfig, options: S3ClientOptions = {}): S3Client {
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
        maxAttempts: options.maxAttempts ?? S3_MAX_ATTEMPTS,
        requestHandler: {
            connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
            requestTimeout: options.requestTimeoutMs ?? S3_REQUEST_TIMEOUT_MS,
            throwOnRequestTimeout: true,
        },
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
    // 用配置值而不是 relayLimitBytes：中转通道的 64MB 是给 Node 内存兜底的，直传不经过 Node。
    // 取错上限会让 maxFileSizeMb>64 的存储上 mode=post（推荐通道）在 64MB 就被桶拒绝，
    // 而同一份配置下 PUT 直传 + 登记能正常收到 200MB —— 两条直传通道口径不一致。
    const maxBytes = fileSizeLimitBytes(config.maxFileSizeMb);
    const { createPresignedPost } = await import('@aws-sdk/s3-presigned-post');
    const post = await createPresignedPost(client, {
        Bucket: config.bucket,
        Key: key,
        Expires: expiresIn,
        Fields: { 'Content-Type': mimeType || 'application/octet-stream' },
        // 下界取 0：空文件在 PUT 通道与登记侧都是合法输入，policy 不该在这里另立规则
        Conditions: [['content-length-range', 0, maxBytes], { 'Content-Type': mimeType || 'application/octet-stream' }],
    });
    return { url: post.url, fields: post.fields, maxBytes, expiresIn };
}

/** 读取对象元数据（直传登记时校验真实大小用） */
export async function headObject(config: StorageConfig, key: string) {
    const client = createS3Client(config);
    return client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
}

/** 预签名下载地址；配置了 publicBaseUrl 时直接返回公共地址 */
/**
 * 预签名失败告警：客户端会收到降级结果（url=null 或脱敏 502），但配置类故障必须在服务端留痕，
 * 否则「图全裂了」在日志里查无此事。列表接口一次为整页行各签一次（同一套凭证成片失败），
 * 按 config.id 60 秒节流，坏配置不会刷屏；条目数由 storage_configs 规模决定，不会失控。
 */
const presignWarnedAt = new Map<string, number>();

export function warnPresignFailure(configId: string, key: string, error: unknown): void {
    const now = Date.now();
    if (now - (presignWarnedAt.get(configId) ?? 0) < 60_000) return;
    presignWarnedAt.set(configId, now);
    console.warn(`[storage] 预签名失败（config=${configId} key=${key}）:`, (error as Error)?.message || error);
}

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
    // 这一条要把整个正文推给桶（最大 64MB），超时按写入档给；只试一次，
    // 免得挂死的网关带着已缓冲的正文再重来一遍。
    const client = createS3Client(config, { requestTimeoutMs: S3_UPLOAD_REQUEST_TIMEOUT_MS, maxAttempts: 1 });
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

/** maxFileSizeMb 的允许上限：2048MB 折算字节已超出 attachments.size（int4）范围 1 字节 */
export const MAX_FILE_SIZE_MB_LIMIT = 2047;

/**
 * 单个文件的体积上限（字节）。
 * assertFileSize 与 POST policy 的 content-length-range 都取这一处，避免两条上传通道各算一份。
 */
export function fileSizeLimitBytes(maxFileSizeMb: number | null | undefined): number {
    return (maxFileSizeMb || 20) * 1024 * 1024;
}

export function assertFileSize(config: Pick<StorageConfig, 'maxFileSizeMb'>, size: number) {
    if (size > fileSizeLimitBytes(config.maxFileSizeMb)) {
        throw createError({ statusCode: 400, statusMessage: `文件超过 ${config.maxFileSizeMb}MB 限制` });
    }
}

/**
 * 服务端中转上传的硬上限。
 *
 * readMultipartFormData() 会把整个请求体读进内存，因此必须在解析前依据
 * Content-Length 拒绝超大请求，否则单次上传就可能耗尽 Node 进程内存。
 * 该上限同时作为**实际字节**封顶传给 `readCappedBodyIntoH3Cache`，所以不带长度头的 chunked 请求
 * 也只能把 `relayReadLimitBytes()` 这么多字节留在内存里（此前 chunked 会绕过前置校验被整个缓冲）。
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
 * 中转上传在**读取阶段**就要收口的字节上限，与 `assertRelayRequestAllowed` 同一阈值。
 * multipart 解析器只吃整段 Buffer，所以内存上界必须设在读的时候；这个值含协议开销宽容量。
 */
export function relayReadLimitBytes(maxFileSizeMb: number | null | undefined): number {
    return relayLimitBytes(maxFileSizeMb) + MULTIPART_OVERHEAD_BYTES;
}

/**
 * 读取请求体之前的前置校验。
 * 依据 Content-Length 提前拒绝超大请求，省掉一次白读的带宽与解析；
 * 不带长度头的 chunked 请求由 `relayReadLimitBytes` + `readCappedBodyIntoH3Cache` 的实际字节封顶兜住，
 * 解析后再由 `assertRelayPayloadSize` 校验文件本身体积。
 */
export function assertRelayRequestAllowed(contentLength: unknown, maxFileSizeMb: number | null | undefined): void {
    const limit = relayReadLimitBytes(maxFileSizeMb);
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > limit) {
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

/** 每用户累计存储硬上限：三条上传通道都只限单文件体积，不封顶用户可以反复传满即撑爆桶 */
export const USER_STORAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * 累计容量闸门的**预检**：只读不求锁，用于在中转上传把对象推上桶之前先拒掉注定超配额的请求，
 * 省掉一次无谓的 64MB PUT。它本身不具并发正确性，真正的登记必须走 `registerAttachmentWithinQuota`。
 */
export async function assertUserStorageQuota(userId: string, incomingBytes: number): Promise<void> {
    const [row] = await db
        .select({ used: sql<string>`coalesce(sum(${attachments.size}), 0)::text` })
        .from(attachments)
        .where(eq(attachments.userId, userId));
    checkUserStorageQuota(incomingBytes, row?.used);
}

/** 闸门文案复用，避免预检与登记两条路径给出不同的 413 说明 */
function checkUserStorageQuota(incomingBytes: number, usedText: string | undefined): void {
    const used = Number(usedText ?? '0');
    if (used + incomingBytes > USER_STORAGE_QUOTA_BYTES) {
        throw createError({
            statusCode: 413,
            statusMessage: `附件总容量已达上限（${Math.round(USER_STORAGE_QUOTA_BYTES / 1024 / 1024 / 1024)}GB），请清理历史附件后重试`,
        });
    }
}

/**
 * 附件登记：把「同一对象去重」「累计用量校验」「插入行」放进同一个事务，并在事务里持有用户级 advisory lock。
 *
 * 此前两条上传通道都是先 `assertUserStorageQuota()` 求和、再各自独立 `insert`：同一用户并发
 * 发 N 个请求时，每个请求读到的都是改动前的总量，于是全部通过闸门并全部落库，配额被永久超出
 * （没有任何回收路径会把它压回去）。`billing.ts` 开通会员用的是同一套「锁 + 事务内重读」，
 * 这里对齐同一个写法。
 *
 * 去重也必须在锁内做：直传重试（响应丢失后再发一次 complete）在锁外查「这条 objectKey 登记过没有」
 * 时，两个并发请求会同时查到「没有」，各自插一行、两行共用同一个对象——删掉任一行都会连带删对象，
 * 另一行就成了永久死链。表上没有 (user_id, object_key) 唯一索引，所以只能靠这把锁把读写串起来。
 *
 * 返回值里的 `duplicateOf` 表示本次没有新插入行，而是命中了同一用户下已登记的同 key 记录。
 * 调用方若在把对象推上桶之后才登记，捕获到 413 时必须自己删掉那个对象（直传通道就是这么做的）。
 */
export async function registerAttachmentWithinQuota(
    row: typeof attachments.$inferInsert & { id: string },
): Promise<{ id: string; duplicateOf: typeof attachments.$inferSelect | null }> {
    const userId = row.userId;
    const incomingBytes = row.size ?? 0;
    return db.transaction(async (tx) => {
        // 锁键与会员开通的锁分开：那把锁按 userId 原样哈希，两把锁同名会互相排队
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'attachments:' + userId}, 0))`);
        if (row.objectKey) {
            const [existing] = await tx
                .select()
                .from(attachments)
                .where(and(eq(attachments.userId, userId), eq(attachments.objectKey, row.objectKey)))
                .limit(1);
            // 命中即幂等返回：既不重复插行，也不重复占用配额
            if (existing) return { id: existing.id, duplicateOf: existing };
        }
        const [used] = await tx
            .select({ used: sql<string>`coalesce(sum(${attachments.size}), 0)::text` })
            .from(attachments)
            .where(eq(attachments.userId, userId));
        checkUserStorageQuota(incomingBytes, used?.used);
        await tx.insert(attachments).values(row);
        return { id: row.id, duplicateOf: null };
    });
}

export { DEFAULT_PRESIGN_EXPIRES };
