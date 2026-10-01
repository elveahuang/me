import { desc, eq } from 'drizzle-orm';
import { skills } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { SKILL_DESCRIPTION_MAX, SKILL_INSTRUCTIONS_MAX, normalizeSkillName, normalizeSkillText } from '../../utils/admin-skill-input';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { requireMethod } from '../../utils/method';

/**
 * Skill = 可复用的指令块（不可执行）。
 * 挂载到智能体后，其 instructions 会被注入系统提示词。
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    // 其余方法（PUT/PATCH/DELETE）原本落进下面的读取分支：请求拿到 200 + 列表，看起来像写成功了
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        const name = normalizeSkillName(body.name);
        const id = crypto.randomUUID();
        await db.insert(skills).values({
            id,
            name,
            description: body.description === undefined ? '' : normalizeSkillText(body.description, 'description', SKILL_DESCRIPTION_MAX),
            instructions: body.instructions === undefined ? '' : normalizeSkillText(body.instructions, 'instructions', SKILL_INSTRUCTIONS_MAX),
            enabled: normalizeAdminBoolean(body.enabled, 'enabled', true),
        });
        const [row] = await db.select().from(skills).where(eq(skills.id, id));
        return row;
    }

    return db.select().from(skills).orderBy(desc(skills.createdAt));
});
