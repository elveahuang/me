import { importNdjsonBackup } from '../../utils/backup-import-ndjson';
import { requireMethod } from '../../utils/method';
import { LOCAL_OWNER } from '../../utils/owner';
import { rateLimit } from '../../utils/rate-limit';
import { readCappedBodyText } from '../../utils/request-body';

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/**
 * `POST /api/import/ndjson`：导入 `GET /api/export/ndjson` 的整机导出（P3-5）。
 *
 * 和 JSON 导入共用同一份限流桶与 20MB 上限；body 直接是 `application/x-ndjson` 文本。
 * 解析/校验和验证在 [backup-import-ndjson.ts]；真正的写入仍是 `importWorkBackup()` 的单事务合并。
 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);
    const limited = await rateLimit(`import:${LOCAL_OWNER}`, 3, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: `导入过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    const text = await readCappedBodyText(event, MAX_BACKUP_BYTES);
    if (!text.trim()) throw createError({ statusCode: 400, statusMessage: '请求体为空' });
    return importNdjsonBackup(text);
});
