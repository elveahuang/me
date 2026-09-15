import { desc, eq } from 'drizzle-orm';
import { tools } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

/** 仅允许 http/https 协议，阻止 file:/data: 等危险协议。 */
function assertHttpUrl(raw: string) {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'config.url 不是合法 URL' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw createError({ statusCode: 400, statusMessage: 'config.url 仅允许 http/https 协议' });
    }
}

const AVAILABLE_TOOL_TYPES = ['builtin_time', 'http'];

/**
 * Tool = 可执行的 AI SDK tool（builtin_time 内置 / http 后台配置）。
 * 挂载到智能体后进入 ReAct 循环。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = await readBody(event);
        const type = AVAILABLE_TOOL_TYPES.includes(body.type) ? body.type : 'builtin_time';
        if (!body.name) {
            throw createError({ statusCode: 400, statusMessage: 'name 必填' });
        }
        if (type === 'http') {
            if (!body.config?.url) {
                throw createError({ statusCode: 400, statusMessage: 'HTTP 工具必须配置 config.url' });
            }
            assertHttpUrl(body.config.url);
        }
        const id = crypto.randomUUID();
        await db.insert(tools).values({
            id,
            name: body.name,
            description: body.description ?? '',
            type,
            config: body.config ?? {},
            enabled: body.enabled ?? true,
        });
        const [row] = await db.select().from(tools).where(eq(tools.id, id));
        return row;
    }

    return db.select().from(tools).orderBy(desc(tools.createdAt));
});
