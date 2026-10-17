import { importWorkBackup } from '../utils/backup-import';
import { requireMethod } from '../utils/method';
import { LOCAL_OWNER } from '../utils/owner';
import { rateLimit } from '../utils/rate-limit';
import { readCappedJsonBody } from '../utils/request-body';

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/** `POST /api/import`：合并导入 `GET /api/export` 生成的 JSON 备份。 */
export default defineEventHandler(async (event) => {
    requireMethod(event, ['POST']);
    const limited = await rateLimit(`import:${LOCAL_OWNER}`, 3, 60_000);
    if (!limited.ok) throw createError({ statusCode: 429, statusMessage: `导入过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    const payload = await readCappedJsonBody<unknown>(event, MAX_BACKUP_BYTES);
    return importWorkBackup(payload);
});
