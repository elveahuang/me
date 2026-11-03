import { sendStream } from 'h3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { backupBuilders, backupTables, REDACTED, SKIPPED } from '../../utils/backup-builders';
import { buildBackupPage } from '../../utils/backup-pages';
import { requireMethod } from '../../utils/method';
import { LOCAL_OWNER } from '../../utils/owner';
import { intParam } from '../../utils/query';
import { rateLimit } from '../../utils/rate-limit';
import { capBody } from '../../utils/request-body';
import { shanghaiDateKey } from '../../utils/work-day';

/**
 * 流式备份（P3-5）：`GET /api/export/ndjson` 每行一个 JSON。
 *
 * 两种模式：
 * - 不带 `table`：整机顺序导出，每张表一次性 `db.select()`，峰值是最大的一张表。
 * - 带 `table=&after=&limit=`：只导出指定表的一页，游标是主键值 JSON 数组（`tableEnd.nextAfter`），
 *   用来把大表切成可重试的分片；`after` 缺省即第一页。
 *
 * 边界：分页模式每页各自有 checksum，不能把多页拼成一个 checksum 校验；`POST /api/import`
 * 仍只接受整份 JSON，NDJSON 恢复尚未实现。脱敏口径与 JSON 备份一致。
 */

function line(value: unknown): string {
    return `${JSON.stringify(value)}\n`;
}

export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);

    const limited = await rateLimit(`export:${LOCAL_OWNER}`, 6, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `导出过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }

    const query = getQuery(event);
    const table = typeof query.table === 'string' && query.table ? query.table : '';
    if (table && !Object.hasOwn(backupTables, table)) {
        throw createError({ statusCode: 400, statusMessage: `未知的备份表：${table}` });
    }
    const limit = intParam(query.limit, 500, 1, 2000);
    let after: unknown[] | null = null;
    if (typeof query.after === 'string' && query.after) {
        try {
            const parsed: unknown = JSON.parse(query.after);
            if (!Array.isArray(parsed)) throw new Error('not array');
            after = parsed;
        } catch {
            throw createError({ statusCode: 400, statusMessage: 'after 必须是主键值的 JSON 数组' });
        }
    }
    if (!table && after) throw createError({ statusCode: 400, statusMessage: 'after 只能与 table 一起使用' });
    // 先取页再开流：游标列数不对时还能返回 400，而不是响应头已发出去后从流中间断掉
    let page: Awaited<ReturnType<typeof buildBackupPage>> | null = null;
    if (table) {
        try {
            page = await buildBackupPage(table, after, limit);
        } catch (error) {
            throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : '分页游标无效' });
        }
    }

    const exportedAt = new Date().toISOString();
    const digest = createHash('sha256');

    const body = Readable.from(
        (async function* () {
            yield line({
                type: 'meta',
                format: 'work.backup.ndjson',
                version: 1,
                backupVersion: 5,
                exportedAt,
                mode: table ? 'table' : 'all',
                ...(table ? { table, after, limit } : {}),
                redacted: REDACTED,
                skipped: SKIPPED,
                note: '每行一个事件；type=table 后跟该表逐行 type=row，最后 type=end。当前不可直接导入。',
            });

            if (table && page) {
                yield line({ type: 'table', table });
                for (const row of page.rows) {
                    const payload = line({ type: 'row', table, row });
                    digest.update(payload);
                    yield payload;
                }
                yield line({ type: 'tableEnd', table, count: page.rows.length, hasMore: page.hasMore, nextAfter: page.nextAfter });
                yield line({ type: 'end', checksum: digest.digest('hex'), exportedAt });
                return;
            }

            for (const [name, build] of Object.entries(backupBuilders)) {
                yield line({ type: 'table', table: name });
                const rows = await build();
                // systemSettings 是单例对象，包一层保持「表 = 行集合」的一致性
                const list = rows === null || rows === undefined ? [] : Array.isArray(rows) ? rows : [rows];
                for (const row of list) {
                    const payload = line({ type: 'row', table: name, row });
                    digest.update(payload);
                    yield payload;
                }
                yield line({ type: 'tableEnd', table: name, count: list.length });
            }

            yield line({ type: 'end', checksum: digest.digest('hex'), exportedAt });
        })(),
    );

    setHeader(event, 'content-type', 'application/x-ndjson; charset=utf-8');
    const suffix = table ? `-${table}` : '';
    setHeader(event, 'content-disposition', `attachment; filename="work-backup-${shanghaiDateKey()}${suffix}.ndjson"`);
    setHeader(event, 'cache-control', 'no-store');
    return sendStream(event, body);
});
