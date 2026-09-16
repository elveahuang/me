import { asc, eq } from 'drizzle-orm';
import { mcpServers } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { maskHeaders } from '../../utils/mcp';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = await readBody(event);
        if (!body.name || !body.url) {
            throw createError({ statusCode: 400, statusMessage: 'name 和 url 必填' });
        }
        const existing = await db.select({ id: mcpServers.id }).from(mcpServers).where(eq(mcpServers.name, body.name));
        if (existing.length) {
            throw createError({ statusCode: 409, statusMessage: `同名 MCP Server「${body.name}」已存在` });
        }
        const id = crypto.randomUUID();
        await db.insert(mcpServers).values({
            id,
            name: body.name,
            url: body.url,
            transport: body.transport === 'sse' ? 'sse' : 'http',
            headers: body.headers ?? {},
            enabled: body.enabled ?? true,
        });
        const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id));
        return row ? { ...row, headers: maskHeaders(row.headers) } : row;
    }

    const rows = await db.select().from(mcpServers).orderBy(asc(mcpServers.createdAt));
    return rows.map((row) => ({ ...row, headers: maskHeaders(row.headers) }));
});
