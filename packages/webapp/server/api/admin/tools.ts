import { desc, eq } from 'drizzle-orm';
import { tools } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { normalizeToolConfig, normalizeToolDescription, normalizeToolName, normalizeToolType } from '../../utils/admin-tool-input';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { requireMethod } from '../../utils/method';

/**
 * Tool = 可执行的 AI SDK tool（builtin_time 内置 / http 后台配置）。
 * 挂载到智能体后进入 ReAct 循环。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    // 其余方法（PUT/PATCH/DELETE）原本落进下面的读取分支：请求拿到 200 + 列表，看起来像写成功了
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        const name = normalizeToolName(body.name);
        const config = normalizeToolConfig(body.config);
        const type = body.type === undefined ? 'builtin_time' : normalizeToolType(body.type);
        // 协议/长度校验已在 normalizeToolConfig 里做（POST 与 PATCH 共用），这里只补「http 工具必须有 url」
        if (type === 'http' && !config.url) {
            throw createError({ statusCode: 400, statusMessage: 'HTTP 工具必须配置 config.url' });
        }
        const id = crypto.randomUUID();
        await db.insert(tools).values({
            id,
            name,
            description: normalizeToolDescription(body.description),
            type,
            config,
            enabled: normalizeAdminBoolean(body.enabled, 'enabled', true),
        });
        const [row] = await db.select().from(tools).where(eq(tools.id, id));
        return row;
    }

    return db.select().from(tools).orderBy(desc(tools.createdAt));
});
