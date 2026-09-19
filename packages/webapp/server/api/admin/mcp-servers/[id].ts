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
    // PATCH 必须和 POST 走同一套归一化：此前 name 可以是空串（会拼出 `mcp__tool` 这种工具前缀），
    // transport 是 text 列、脏值只会静默按 http 连接，enabled 传非布尔则直接 500。
    const renamed = body.name !== undefined;
    const newName = renamed ? (typeof body.name === 'string' ? body.name.trim() : '') : '';
    if (renamed && !newName) {
        throw createError({ statusCode: 400, statusMessage: 'name 不能为空' });
    }
    if (renamed) patch.name = newName;
    if (body.transport !== undefined) patch.transport = body.transport === 'sse' ? 'sse' : 'http';
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.url !== undefined) patch.url = assertAbsoluteHttpUrl('url', body.url);
    if (body.headers !== undefined) patch.headers = mergeHeaders(existing.headers, body.headers);

    if (renamed) {
        // server 名用作运行时工具前缀（mcp_<name>_<tool>），重名会导致工具集合并时静默覆盖。
        // 与新建一样按新 name 取事务级咨询锁，串行化「查重 + 改名」，关闭先查后改的并发窗口。
        await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${newName})::bigint)`);
            const conflict = await tx
                .select({ id: mcpServers.id })
                .from(mcpServers)
                .where(and(eq(mcpServers.name, newName), ne(mcpServers.id, id)));
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
