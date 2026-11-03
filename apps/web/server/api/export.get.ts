import { backupBuilders, REDACTED, SKIPPED } from '../utils/backup-builders';
import { backupChecksum } from '../utils/backup-checksum';
import { requireMethod } from '../utils/method';
import { LOCAL_OWNER } from '../utils/owner';
import { rateLimit } from '../utils/rate-limit';
import { capBody } from '../utils/request-body';
import { shanghaiDateKey } from '../utils/work-day';

/**
 * 全量数据导出：`GET /api/export` → 一份 JSON 备份文件。
 *
 * 为什么本机应用尤其需要它：工作台的数据全在这台机器的 PostgreSQL 里，没有账号、没有云端副本，
 * 于是「换机器 / 重装 / 留一份自己的数据」只有两条路——要么会写 psql 的人自己 dump，要么丢数据。
 *
 * 三处刻意不带出：
 * - `kb_chunks`：向量是可再生的派生数据（重建索引即可），带进备份只会让文件
 *   按分块数 × 维度膨胀，而且换过嵌入模型后那些向量本来就不可比（见 utils/embedding 的维度口径）。
 * - `providers.api_key`、`storage_configs.secret_access_key`：备份文件是会被拷走、发出去的产物，
 *   把密钥一起写进去等于把「数据库泄露」升级成「备份泄露」。导出成空串，导入后在设置页重新填。
 * - `mcp_servers.headers` 与 `tools.config.headers`：同一件事的另两个藏处。MCP 的鉴权就是这组请求头
 *   （通常是 `Authorization: Bearer …`），HTTP 工具的 `config.headers` 同样由管理员钉死凭据；
 *   读接口两边都会打码（`utils/mcp` 的 `maskHeaders`、`settings/tools` 的脱敏），只有备份文件曾整份明文带走。
 *   头名留在 `redactedHeaders` 里，还原时知道要补哪几个键；URL/`config.url` 仍原样导出，那是端点不是凭据。
 * - 附件二进制：对象存储里的桶需要另行备份，这里只给元数据与 objectKey。
 *
 * 整份文件在内存里序列化且行数不封顶；单用户工作台的量级（几千条消息）远不到风险线，
 * 但**不要**把它挂进任何轮询或后台任务。需要边读边写时走 `/api/export/ndjson`。
 */

export default defineEventHandler(async (event) => {
    await capBody(event);
    requireMethod(event, ['GET']);

    const limited = await rateLimit(`export:${LOCAL_OWNER}`, 6, 60_000);
    if (!limited.ok) {
        throw createError({ statusCode: 429, statusMessage: `导出过于频繁，请 ${limited.retryAfterSec} 秒后再试` });
    }

    const data: Record<string, unknown> = {};
    await Promise.all(
        Object.entries(backupBuilders).map(async ([key, build]) => {
            data[key] = await build();
        }),
    );

    setHeader(event, 'content-disposition', `attachment; filename="work-backup-${shanghaiDateKey()}.json"`);

    return {
        format: 'work.backup',
        version: 5,
        exportedAt: new Date().toISOString(),
        redacted: REDACTED,
        skipped: SKIPPED,
        checksum: backupChecksum(data),
        data,
    };
});
