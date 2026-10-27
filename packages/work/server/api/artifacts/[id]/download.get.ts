import { eq } from 'drizzle-orm';
import { sendStream } from 'h3';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { artifacts } from '../../../db/schema';
import { db } from '../../../utils/db';
import { resolveAllowedPath } from '../../../utils/local-files';
import { requireMethod } from '../../../utils/method';
import { routeId } from '../../../utils/route-id';

/**
 * `GET /api/artifacts/{id}/download`：按登记路径回读文件。
 *
 * 不信任库里的旧路径：下载时重新 `resolveAllowedPath`，目录已移出 WORK_FILE_ROOTS 的记录会失效，
 * 避免一份旧备份/旧会话把白名单之外的绝对路径变成可下载链接。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['GET']);
    const id = routeId(event, 'id', '交付物');
    const [row] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
    if (!row) throw createError({ statusCode: 404, statusMessage: '交付物不存在' });
    const path = await resolveAllowedPath(row.path);
    const info = await stat(path);
    if (!info.isFile()) throw createError({ statusCode: 404, statusMessage: '交付物文件已不存在' });

    setHeader(event, 'content-type', row.mimeType || 'application/octet-stream');
    setHeader(event, 'content-length', info.size);
    setHeader(event, 'content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.title)}`);
    return sendStream(event, createReadStream(path));
});
