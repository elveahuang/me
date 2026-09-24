import { eq } from 'drizzle-orm';
import { skills } from '../../../db/schema';
import { normalizeAdminBoolean } from '../../../utils/admin-boolean';
import { SKILL_DESCRIPTION_MAX, SKILL_INSTRUCTIONS_MAX, normalizeSkillName, normalizeSkillText } from '../../../utils/admin-skill-input';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;
    const body = (await readBody(event)) ?? {};

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    // 与新建走同一套归一：非字符串/超长/enabled 非布尔原本都直写列，被 PG 拒成 500 并透出 SQL 细节
    if (body.name !== undefined) patch.name = normalizeSkillName(body.name);
    if (body.description !== undefined) patch.description = normalizeSkillText(body.description, 'description', SKILL_DESCRIPTION_MAX);
    if (body.instructions !== undefined) patch.instructions = normalizeSkillText(body.instructions, 'instructions', SKILL_INSTRUCTIONS_MAX);
    if (body.enabled !== undefined) patch.enabled = normalizeAdminBoolean(body.enabled, 'enabled', true);
    await db.update(skills).set(patch).where(eq(skills.id, id));
    const [row] = await db.select().from(skills).where(eq(skills.id, id));
    if (!row) throw createError({ statusCode: 404, statusMessage: '技能不存在' });
    return row;
});
