import { and, eq, ne, sql } from 'drizzle-orm';
import { mcpServers } from '../../../db/schema';
import { normalizeAdminBoolean } from '../../../utils/admin-boolean';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { maskHeaders, mergeHeaders, normalizeMcpHeaders, normalizeMcpName, normalizeMcpTransport } from '../../../utils/mcp';
import { requireMethod } from '../../../utils/method';
import { assertAbsoluteHttpUrl } from '../../../utils/outbound';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    // GET 原本会落进下面的更新分支（readBody 得空对象 → 只推进 updatedAt），读一次就写一次库
    const method = requireMethod(event, ['PATCH', 'DELETE']);
    const id = getRouterParam(event, 'id')!;

    if (method === 'DELETE') {
        // 0 行影响也要报出来：否则 id 抄错或行已被另一个管理员删掉时，界面照样提示「已删除」
        const deleted = await db.delete(mcpServers).where(eq(mcpServers.id, id)).returning({ id: mcpServers.id });
        if (!deleted.length) throw createError({ statusCode: 404, statusMessage: 'MCP Server 不存在' });
        return { ok: true };
    }

    const body = (await readBody(event)) ?? {};

    const [existing] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
    if (!existing) {
        throw createError({ statusCode: 404, statusMessage: 'MCP Server 不存在' });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    // PATCH 与 POST 共用同一套归一：此前 name 可以是空串（会拼出 `mcp__tool` 这种工具前缀），
    // transport 是 text 列、脏值只会静默按 http 连接，enabled 用 Boolean() 把 'false' 变成 true。
    const renamed = body.name !== undefined;
    const newName = renamed ? normalizeMcpName(body.name) : '';
    if (renamed) patch.name = newName;
    if (body.transport !== undefined) patch.transport = normalizeMcpTransport(body.transport);
    if (body.enabled !== undefined) patch.enabled = normalizeAdminBoolean(body.enabled, 'enabled', existing.enabled);
    if (body.url !== undefined) patch.url = assertAbsoluteHttpUrl('url', body.url);
    if (body.headers !== undefined) patch.headers = mergeHeaders(existing.headers, normalizeMcpHeaders(body.headers));

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
