import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { H3Event } from 'h3';
import type { StorageConfig } from '../db/schema';
import { attachments } from '../db/schema';
import { db } from '../utils/db';
import { requireMethod } from '../utils/method';
import { LOCAL_OWNER } from '../utils/owner';
import { intParam, likePattern, stringParam } from '../utils/query';
import { rateLimit } from '../utils/rate-limit';
import { capBody, readCappedBodyIntoH3Cache } from '../utils/request-body';
import {
    assertRelayPayloadSize,
    assertRelayRequestAllowed,
    assertStorageQuota,
    buildObjectKey,
    buildPublicUrl,
    deleteObject,
    isMimeAllowed,
    normalizeAttachmentCategory,
    normalizeMimeType,
    pickStorageConfig,
    presignDownload,
    putObject,
    registerAttachmentWithinQuota,
    relayReadLimitBytes,
    resolveStorageConfig,
    resolveStorageConfigMap,
    sanitizeFilename,
    warnPresignFailure,
} from '../utils/storage';

async function safePresign(config: StorageConfig, key: string): Promise<string | null> {
    try {
        return await presignDownload(config, key);
    } catch (error) {
        warnPresignFailure(config.id, key, error);
        return null;
    }
}

/**
 * 上传附件（服务端中转）。
 *
 * multipart/form-data：file（必填）+ category（可选）
 * 走服务端 putObject 而不是前端直传，原因：
 * 自建对象存储（RustFS / MinIO）通常没有配置浏览器跨域规则，直传会先在 CORS 预检失败。
 * 超过 RELAY_UPLOAD_HARD_LIMIT_MB 的文件应改用 POST /api/attachments/presign 直传。
 */
async function relayUpload(event: H3Event) {
    // multipart 的封顶值取决于「这条配置允许的 MB 数 + 协议开销」，而配置要查库才知道，
    // 所以不能在这里套公共 256KB 闸门——那会把 1MB 以上的正常上传提前 413，
    // 且读过之后流就没了，下面按配置上限的那次读只能拿到缓存。非 multipart 请求仍走公共闸门。
    if (!(getHeader(event, 'content-type') ?? '').startsWith('multipart/form-data')) await capBody(event);

    // 中转上传每次都会真实 putObject 到对象存储；体积闸门只挡单请求大小、挡不住频率，
    // 放在读体之前让超限请求连正文都不必读（正文最大 64MB+64KB 协议开销）
    const limited = await rateLimit(`attach-relay:${LOCAL_OWNER}`, 30, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }

    // 解析请求体前先按 Content-Length 拦截，避免超大请求被整体读入内存
    const config = await resolveStorageConfig(null);
    assertRelayRequestAllowed(getHeader(event, 'content-length'), config.maxFileSizeMb);

    // Content-Length 是客户端自己声明的，chunked 更是压根没有这个头——只靠上面那道预检，
    // readMultipartFormData 会把任意大的正文整个缓冲进内存（它只接受读完后的一整段 Buffer）。
    // 所以这里按**实际字节**封顶，并把读到的字节塞进 h3 自己的 raw body 缓存位，让下面的解析器复用。
    if ((getHeader(event, 'content-type') ?? '').startsWith('multipart/form-data')) {
        await readCappedBodyIntoH3Cache(event, relayReadLimitBytes(config.maxFileSizeMb));
    }

    const parts = (await readMultipartFormData(event)) ?? [];
    const filePart = parts.find((part) => part.name === 'file');
    if (!filePart) {
        throw createError({ statusCode: 400, statusMessage: '缺少 file 字段' });
    }
    const categoryPart = parts.find((part) => part.name === 'category');
    const category = normalizeAttachmentCategory(categoryPart?.data.toString('utf-8'));

    const filename = sanitizeFilename(filePart.filename || 'file');
    const mimeType = normalizeMimeType(filePart.type);
    const size = filePart.data.length;

    // 兜底：伪造 Content-Length 或 chunked 请求在解析后再次校验
    assertRelayPayloadSize(size, config.maxFileSizeMb);
    if (!isMimeAllowed(config, mimeType)) {
        throw createError({ statusCode: 400, statusMessage: `该存储不允许上传 ${mimeType} 类型文件` });
    }
    if (!config.accessKeyId || !config.secretAccessKey) {
        throw createError({ statusCode: 503, statusMessage: '对象存储缺少访问密钥，请在「设置 → 存储配置」中补全' });
    }
    await assertStorageQuota(size);

    const objectKey = buildObjectKey(config, filename, category);
    try {
        await putObject(config, objectKey, filePart.data, mimeType);
    } catch (error) {
        // SDK 错误原文可能带 endpoint/RequestID，只进服务端日志，响应回泛化文案
        console.error('[attachments] 对象存储上传失败:', error);
        throw createError({ statusCode: 502, statusMessage: '对象存储上传失败，请检查存储配置或稍后重试' });
    }

    const id = crypto.randomUUID();
    let registered: Awaited<ReturnType<typeof registerAttachmentWithinQuota>>;
    try {
        // 闸门 + 落库在同一事务里持锁：并发上传时后一个请求一定读得到前一个已登记的体积
        registered = await registerAttachmentWithinQuota({
            id,
            storageConfigId: config.id,
            objectKey,
            filename,
            mimeType,
            size,
            category,
        });
    } catch (error) {
        // 预检之后仍有并发把配额用满：对象已经上桶，必须清掉，否则越限内容留在桶里却没有记录（也就再也删不掉）
        await deleteObject(config, objectKey).catch((cleanupError) =>
            console.warn(`[attachments] 清理上传失败对象出错（key=${objectKey}）:`, (cleanupError as Error)?.message || cleanupError),
        );
        throw error;
    }

    const publicUrl = buildPublicUrl(config, objectKey);
    let url = publicUrl;
    if (!url) {
        try {
            url = await presignDownload(config, objectKey);
        } catch (error) {
            warnPresignFailure(config.id, objectKey, error);
            url = null;
        }
    }

    return {
        // 用登记结果里的 id：objectKey 由本次请求新生成，正常恒等于本地 id，
        // 但响应里的 id 必须是「库里真的存在的那一行」，不能是未经校验的本地变量
        id: registered.id,
        filename,
        mimeType,
        size,
        category,
        createdAt: new Date().toISOString(),
        url,
        isImage: mimeType.startsWith('image/'),
    };
}

/**
 * 附件列表（本机工作台的附件全部属于单一主人，没有归属过滤）。
 * 私有桶返回限时预签名 URL（签名在本地计算，不产生存储侧请求）。
 */
export default defineEventHandler(async (event) => {
    // 方法白名单必须在这里，而不是靠文件名后缀：`attachments.get.ts` + `attachments.post.ts`
    // 那种拆法只把 GET/POST 注册进路由表，PUT/PATCH/HEAD 等匹配不到任何 handler，
    // 会一路落到 `/**` 页面渲染器变成 500（还把 SSR 内部错误透给客户端）。
    const method = requireMethod(event, ['GET', 'POST']);
    if (method === 'POST') return relayUpload(event);

    await capBody(event);
    const query = getQuery(event);
    const category = stringParam(query.category);
    const keyword = stringParam(query.keyword) ?? '';
    const page = intParam(query.page, 1, 1, 1e6);
    const pageSize = intParam(query.pageSize, 20, 1, 100);

    const filters: SQL[] = [];
    // `all` 是前端「全部分类」选项的字面值，不是数据库里的分类，照旧当作不筛选
    if (category && category !== 'all') filters.push(eq(attachments.category, category));
    if (keyword) filters.push(sql`${attachments.filename} ilike ${likePattern(keyword)}`);
    const where = filters.length ? and(...filters) : undefined;

    // 列表与总数互不依赖，一次并发发出，避免两次串行往返叠加到响应延迟。
    //
    // 这里**不**算分类占用统计（`stats`）：那是 `GROUP BY category` 的全表聚合，
    // 消费方只有 Web 端的附件总览页，而 work 的附件页已随本轮重构删除——
    // 留着它等于每次打开聊天里的附件选择弹层都重算一遍没人看的数字。
    const [rows, [totalRow]] = await Promise.all([
        db
            .select()
            .from(attachments)
            .where(where)
            .orderBy(desc(attachments.createdAt))
            .limit(pageSize)
            .offset((page - 1) * pageSize),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(attachments)
            .where(where),
    ]);

    // 每条附件按各自的 storageConfigId 解析存储配置（去重后各查一次），
    // 避免用「当前默认配置」给分属其他桶的历史附件签出错误地址。
    const configMap = await resolveStorageConfigMap(rows.map((row) => row.storageConfigId));

    const items = await Promise.all(
        rows.map(async (row) => {
            const config = pickStorageConfig(configMap, row.storageConfigId);
            const publicUrl = config ? buildPublicUrl(config, row.objectKey) : null;
            const url = publicUrl ?? (config ? await safePresign(config, row.objectKey) : null);
            return {
                id: row.id,
                filename: row.filename,
                mimeType: row.mimeType,
                size: row.size,
                category: row.category,
                createdAt: row.createdAt,
                url,
                isImage: row.mimeType.startsWith('image/'),
            };
        }),
    );

    return {
        attachments: items,
        total: totalRow?.count ?? 0,
        page,
        pageSize,
    };
});
