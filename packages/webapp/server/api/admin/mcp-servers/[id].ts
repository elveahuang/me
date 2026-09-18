import { and, eq, ne, sql } from 'drizzle-orm';
import { mcpServers } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { maskHeaders, mergeHeaders } from '../../../utils/mcp';
import { assertAbsoluteHttpUrl } from '../../../utils/outbound';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    if (getMethod(event) === 'DELETE') {
        await db.delete(mcpServers).where(eq(mcpServers.id, id));
        return { ok: true };
    }

    const body = (await readBody(event)) ?? {};

    const [existing] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
    if (!existing) {
        throw createError({ statusCode: 404, statusMessage: 'MCP Server not found' });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'transport', 'enabled'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.url !== undefined) patch.url = assertAbsoluteHttpUrl('url', body.url);
    if (body.headers !== undefined) patch.headers = mergeHeaders(existing.headers, body.headers);

    const renamed = body.name !== undefined;
    const newName = renamed ? String(body.name) : null;

    if (renamed) {
        // server 名用作运行时工具前缀（mcp_<name>_<tool>），重名会导致工具集合并时静默覆盖。
        // 与新建一样按新 name 取事务级咨询锁，串行化「查重 + 改名」，关闭先查后改的并发窗口。
        await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${newName})::bigint)`);
            const conflict = await tx
                .select({ id: mcpServers.id })
                .from(mcpServers)
                .where(and(eq(mcpServers.name, newName!), ne(mcpServers.id, id)));
            if (conflict.length) {
                throw createError({ statusCode: 409, statusMessage: `同名 MCP Server「${newName}」已存在` });
            }
            await tx.update(mcpServers).set(patch).where(eq(mcpServers.id, id));
        });
    } else {
        await db.update(mcpServers).set(patch).where(eq(mcpServers.id, id));
    }

    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
    return row ? { ...row, headers: maskHeaders(row.headers) } : row;
});
