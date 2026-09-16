import { desc, eq } from 'drizzle-orm';
import { skills } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

/**
 * Skill = 可复用的指令块（不可执行）。
 * 挂载到智能体后，其 instructions 会被注入系统提示词。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = await readBody(event);
        if (!body.name) {
            throw createError({ statusCode: 400, statusMessage: 'name 必填' });
        }
        const id = crypto.randomUUID();
        await db.insert(skills).values({
            id,
            name: body.name,
            description: body.description ?? '',
            instructions: body.instructions ?? '',
            enabled: body.enabled ?? true,
        });
        const [row] = await db.select().from(skills).where(eq(skills.id, id));
        return row;
    }

    return db.select().from(skills).orderBy(desc(skills.createdAt));
});
