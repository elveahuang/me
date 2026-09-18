import { eq } from 'drizzle-orm';
import { mcpServers } from '../../../db/schema';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';
import { maskHeaders, mergeHeaders } from '../../../utils/mcp';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    if (getMethod(event) === 'DELETE') {
        await db.delete(mcpServers).where(eq(mcpServers.id, id));
        return { ok: true };
    }

    const body = (await readBody(event)) ?? {};

    // server 名用作运行时工具前缀（mcp_<name>_<tool>），重名会导致工具集合并时静默覆盖
    if (body.name !== undefined) {
        const existing = await db.select({ id: mcpServers.id }).from(mcpServers).where(eq(mcpServers.name, body.name));
        if (existing.length && existing[0]!.id !== id) {
            throw createError({ statusCode: 409, statusMessage: `同名 MCP Server「${body.name}」已存在` });
        }
    }

    const [existing] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
    if (!existing) {
        throw createError({ statusCode: 404, statusMessage: 'MCP Server not found' });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['name', 'url', 'transport', 'enabled'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.headers !== undefined) patch.headers = mergeHeaders(existing.headers, body.headers);
    await db.update(mcpServers).set(patch).where(eq(mcpServers.id, id));
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
    return row ? { ...row, headers: maskHeaders(row.headers) } : row;
});
