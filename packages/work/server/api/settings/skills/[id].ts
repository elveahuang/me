import { eq } from 'drizzle-orm';
import { skills } from '../../../db/schema';
import { normalizeAdminBoolean } from '../../../utils/admin-boolean';
import { SKILL_DESCRIPTION_MAX, SKILL_INSTRUCTIONS_MAX, normalizeSkillName, normalizeSkillText } from '../../../utils/admin-skill-input';
import { db } from '../../../utils/db';
import { requireMethod } from '../../../utils/method';
import { ADMIN_BODY_LIMIT_BYTES, capBody } from '../../../utils/request-body';
import { routeId } from '../../../utils/route-id';

export default defineEventHandler(async (event) => {
    const method = requireMethod(event, ['DELETE', 'PATCH']);
    await capBody(event, ADMIN_BODY_LIMIT_BYTES);
    const id = routeId(event, 'id', '技能');

    if (method === 'DELETE') {
        // 0 行影响也要报出来：否则 id 抄错或行已被另一个管理员删掉时，界面照样提示「已删除」
        const deleted = await db.delete(skills).where(eq(skills.id, id)).returning({ id: skills.id });
        if (!deleted.length) throw createError({ statusCode: 404, statusMessage: '技能不存在' });
        return { ok: true };
    }

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
