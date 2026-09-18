import { asc, eq, sql } from 'drizzle-orm';
import { mcpServers } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { maskHeaders } from '../../utils/mcp';
import { assertAbsoluteHttpUrl } from '../../utils/outbound';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = (await readBody(event)) ?? {};
        if (!body.name || !body.url) {
            throw createError({ statusCode: 400, statusMessage: 'name 和 url 必填' });
        }
        const name = String(body.name);
        const url = assertAbsoluteHttpUrl('url', body.url);
        const id = crypto.randomUUID();
        // name 会被用作运行时工具前缀（mcp_<name>_<tool>），重名会静默覆盖彼此的工具。
        // 表上没有唯一约束，先查再插存在并发双写窗口：以 name 哈希取事务级咨询锁串行化「查重 + 插入」，
        // 锁随事务提交/回滚自动释放，不影响不同 name 的并发创建。
        await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${name})::bigint)`);
            const existing = await tx.select({ id: mcpServers.id }).from(mcpServers).where(eq(mcpServers.name, name));
            if (existing.length) {
                throw createError({ statusCode: 409, statusMessage: `同名 MCP Server「${name}」已存在` });
            }
            await tx.insert(mcpServers).values({
                id,
                name,
                url,
                transport: body.transport === 'sse' ? 'sse' : 'http',
                headers: body.headers ?? {},
                enabled: body.enabled ?? true,
            });
        });
        const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
        return row ? { ...row, headers: maskHeaders(row.headers) } : row;
    }

    const rows = await db.select().from(mcpServers).orderBy(asc(mcpServers.createdAt));
    return rows.map((row) => ({ ...row, headers: maskHeaders(row.headers) }));
});
