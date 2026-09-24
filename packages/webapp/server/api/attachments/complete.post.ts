import { and, eq } from 'drizzle-orm';
import { attachments } from '../../db/schema';
import { db } from '../../utils/db';
import { requireUser } from '../../utils/guard';
import { rateLimit } from '../../utils/rate-limit';
import { readCappedJsonBody } from '../../utils/request-body';
import {
    assertFileSize,
    buildPublicUrl,
    deleteObject,
    headObject,
    isMimeAllowed,
    normalizeAttachmentCategory,
    normalizeMimeType,
    presignDownload,
    registerAttachmentWithinQuota,
    resolveStorageConfig,
    sanitizeFilename,
} from '../../utils/storage';

/**
 * 判断 HeadObject 的失败是"对象不存在"还是"这个存储不支持 HEAD"。
 *
 * 两者必须区分：对象不存在却继续登记，附件列表里就会多出一条指向空对象的记录，
 * 用户要等到下载时才发现问题。
 */
function isMissingObject(error: unknown): boolean {
    const e = error as { name?: string; __type?: string; $metadata?: { httpStatusCode?: number } };
    return e?.name === 'NotFound' || e?.__type === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

/** 存储端明确「未实现」才算能力缺失；AccessDenied/超时等失败不能退回不可信的申报值 */
function isHeadUnsupported(error: unknown): boolean {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return e?.$metadata?.httpStatusCode === 501 || e?.name === 'NotImplemented';
}

type RegistrationRow = Pick<typeof attachments.$inferSelect, 'id' | 'objectKey' | 'filename' | 'mimeType' | 'size' | 'category' | 'createdAt'>;

/** 新登记与幂等命中共用一份响应形状，避免两条路径各拼一遍、拼出差别 */
async function registrationResponse(config: Awaited<ReturnType<typeof resolveStorageConfig>>, row: RegistrationRow) {
    const publicUrl = buildPublicUrl(config, row.objectKey);
    const url = publicUrl ?? (await presignDownload(config, row.objectKey).catch(() => null));
    return {
        id: row.id,
        filename: row.filename,
        mimeType: row.mimeType,
        size: row.size,
        category: row.category,
        createdAt: row.createdAt.toISOString(),
        url,
        isImage: row.mimeType.startsWith('image/'),
    };
}

/**
 * 预签名直传登记（配合 POST /api/attachments/presign 使用）。
 *
 * 前端直传的三步：取预签名地址 → PUT 到对象存储 → 调用本接口登记元数据。
 * 未登记的对象不会出现在附件列表，也无法通过附件接口访问；
 * 因此这里会校验 objectKey 必须落在当前配置的 prefix 下，避免用户把任意已存在对象"认领"为自己的附件。
 */
export default defineEventHandler(async (event) => {
    const session = await requireUser(event);
    // 登记每次都会回源 HeadObject（超限路径还要 deleteObject），是站外网络往返；
    // 与 presign（纯本地签名）不同，这里必须补按次限流——放在读体之前，超限请求连正文都不读
    const limited = await rateLimit(`attach-complete:${session.user.id}`, 60, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `请求过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }
    // 体积闸门与限流各管一件事：限流挡频率，readCappedJsonBody 挡单请求体积。
    // 闸门放在这里不影响后面的 HeadObject 复核——真实体积仍以存储侧返回值为准。
    const body: Record<string, unknown> = (await readCappedJsonBody<Record<string, unknown>>(event)) ?? {};

    const objectKey = String(body.objectKey ?? '').trim();
    if (!objectKey) {
        throw createError({ statusCode: 400, statusMessage: 'objectKey 必填' });
    }
    if (objectKey.length > 512) {
        throw createError({ statusCode: 400, statusMessage: 'objectKey 过长' });
    }
    // 申报体积只作兜底：非法值（负数/小数/NaN）一律当作未知，
    // 否则 Number('-5') 会绕过 `size > 0` 的校验直接写进整型列。
    const declaredSize = Number(body.size);
    const size = Number.isInteger(declaredSize) && declaredSize > 0 ? declaredSize : 0;
    const filename = sanitizeFilename(String(body.filename ?? 'file'));
    const mimeType = normalizeMimeType(body.mimeType);
    const category = normalizeAttachmentCategory(body.category);

    const config = await resolveStorageConfig(null);
    const prefix = (config.prefix || 'uploads').replace(/^\/+|\/+$/g, '');

    // 只接受本配置前缀下、由本服务生成的对象 key（含 UUID 段）
    if (!objectKey.startsWith(`${prefix}/`)) {
        throw createError({ statusCode: 400, statusMessage: 'objectKey 不属于当前存储配置的目录' });
    }
    if (objectKey.includes('..')) {
        throw createError({ statusCode: 400, statusMessage: 'objectKey 非法' });
    }
    if (size > 0) assertFileSize(config, size);
    if (!isMimeAllowed(config, mimeType)) {
        throw createError({ statusCode: 400, statusMessage: `该存储不允许上传 ${mimeType} 类型文件` });
    }

    /**
     * 直传通道的安全闸门。
     *
     * PUT 预签名 URL 无法携带体积条件，客户端申报的 size 也不可信
     * （自报 1 字节即可绕过 maxFileSizeMb 上传任意大小对象）。
     * 因此登记前必须回源对象存储读取真实大小：
     * - 超限：删掉对象并拒绝登记，攻击者既拿不到附件也不占用配额
     * - 未超限：以真实大小为准写库，避免伪造元数据
     */
    let actualSize = size;
    let actualMime = mimeType;
    try {
        const head = await headObject(config, objectKey);
        const contentLength = Number(head.ContentLength ?? 0);
        if (contentLength > 0) actualSize = contentLength;
        if (typeof head.ContentType === 'string' && head.ContentType) actualMime = normalizeMimeType(head.ContentType, actualMime);
    } catch (error) {
        if (isMissingObject(error)) {
            throw createError({ statusCode: 400, statusMessage: '对象不存在或尚未上传完成，无法登记' });
        }
        if (!isHeadUnsupported(error)) {
            // AccessDenied / 桶配置失效 / 网络失败时退回申报值等于放行「自报 1 字节」的绕过，
            // 这类失败登记不出去也不留下半成品，让调用方重试
            throw createError({ statusCode: 502, statusMessage: '无法校验对象真实大小，请稍后重试登记' });
        }
        // 仅对确实未实现 HEAD 的存储保留兼容：退回申报值，上面已按配置上限校验过
    }

    if (actualSize > 0) {
        try {
            assertFileSize(config, actualSize);
        } catch (error) {
            // 真实体积超限：清理已上传对象，不留下"可用"的越权附件
            try {
                await deleteObject(config, objectKey);
            } catch (cleanupError) {
                // 清理失败不改变拒绝结论，但对象会成为无 DB 记录的孤儿（管理端总览按记录查不到），必须留痕
                console.warn(`[attachments] 清理超限附件对象失败（key=${objectKey}）:`, (cleanupError as Error)?.message || cleanupError);
            }
            throw error;
        }
    }

    // 同一对象重复登记（双击/响应丢失后重试）会产生两条共享一个对象的记录，
    // 删除其中一条会连带删对象让另一条永久死链。登记按幂等处理：命中即原样返回已登记记录。
    // 这里只是**快速路径**（省掉一次锁内往返，并让「对象已不在桶里但记录还在」的重试仍能拿到记录）；
    // 真正的并发正确性在 registerAttachmentWithinQuota 里——它持有同一把用户锁，第二个请求必然看得到第一个插的行。
    const [existing] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.userId, session.user.id), eq(attachments.objectKey, objectKey)))
        .limit(1);
    if (existing) {
        return await registrationResponse(config, existing);
    }

    // 累计容量闸门放在幂等检查之后：重复登记不再消耗配额，重试不应被「已用满」误伤
    const id = crypto.randomUUID();
    let registered: Awaited<ReturnType<typeof registerAttachmentWithinQuota>>;
    try {
        // 闸门与登记同事务 + 用户级锁：并发 complete 时每个请求都读到改动前的总量、全部通过的问题在这里堵掉
        registered = await registerAttachmentWithinQuota({
            id,
            userId: session.user.id,
            storageConfigId: config.id,
            objectKey,
            filename,
            mimeType: actualMime,
            size: actualSize,
            category,
        });
    } catch (error) {
        // 超配额与超单文件体积同理：清掉刚直传的对象，不让越权内容留在桶里
        try {
            await deleteObject(config, objectKey);
        } catch (cleanupError) {
            // 清理失败不改变拒绝结论，但对象会成为无 DB 记录的孤儿，必须留痕
            console.warn(`[attachments] 清理被拒附件对象失败（key=${objectKey}）:`, (cleanupError as Error)?.message || cleanupError);
        }
        throw error;
    }

    // 锁内才发现的重复：另一个并发 complete 已经登记过，本次没有插行，也不能去删那个共享对象
    if (registered.duplicateOf) {
        return await registrationResponse(config, registered.duplicateOf);
    }

    return await registrationResponse(config, {
        id: registered.id,
        objectKey,
        filename,
        mimeType: actualMime,
        size: actualSize,
        category,
        createdAt: new Date(),
    });
});
