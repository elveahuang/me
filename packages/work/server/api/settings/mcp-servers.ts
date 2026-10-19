import { asc, eq, sql } from 'drizzle-orm';
import { mcpServers } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { db } from '../../utils/db';
import {
    findMcpNamespaceConflict,
    maskHeaders,
    mcpToolNamespace,
    normalizeMcpHeaders,
    normalizeMcpName,
    normalizeMcpTransport,
    sealHeaders,
} from '../../utils/mcp';
import { requireMethod } from '../../utils/method';
import { assertAbsoluteHttpUrl } from '../../utils/outbound';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../utils/request-body';

export default defineEventHandler(async (event) => {
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);

    // 其余方法（PUT/PATCH/DELETE）原本落进下面的读取分支：请求拿到 200 + 列表，看起来像写成功了
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        // 与 PATCH 共用同一套归一：此前 headers 可以是数组/字符串（jsonb 照收，运行时展开才炸），
        // enabled 非布尔直写 boolean 列成 500，name 也没有长度上限。
        const name = normalizeMcpName(body.name);
        const url = assertAbsoluteHttpUrl('url', body.url);
        const headers = sealHeaders(normalizeMcpHeaders(body.headers));
        const enabled = normalizeAdminBoolean(body.enabled, 'enabled', true);
        const id = crypto.randomUUID();
        // name 会被用作运行时工具前缀（mcp_<name>_<tool>），重名会静默覆盖彼此的工具。
        // 表上没有唯一约束，先查再插存在并发双写窗口：以 name 哈希取事务级咨询锁串行化「查重 + 插入」，
        // 锁随事务提交/回滚自动释放，不影响不同 name 的并发创建。
        // 锁键与查重口径都取「塌成 `_` 之后的命名空间」而不是原始 name：`DB-Core` 与 `DB_Core` 的
        // 原始串不同、拿到的锁也不同，但它们共用一个工具命名空间，按原始串加锁正好放行了这次双写。
        await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${mcpToolNamespace(name)}, 0))`);
            const conflict = await findMcpNamespaceConflict(tx, name);
            if (conflict) {
                throw createError({
                    statusCode: 409,
                    statusMessage: `「${name}」与已有的「${conflict.name}」会生成同一个工具命名空间「${mcpToolNamespace(name)}」，请改名`,
                });
            }
            await tx.insert(mcpServers).values({
                id,
                name,
                url,
                transport: normalizeMcpTransport(body.transport),
                headers,
                enabled,
            });
        });
        const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
        return row ? { ...row, headers: maskHeaders(row.headers) } : row;
    }

    const rows = await db.select().from(mcpServers).orderBy(asc(mcpServers.createdAt));
    return rows.map((row) => ({ ...row, headers: maskHeaders(row.headers) }));
});
