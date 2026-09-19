import { eq } from 'drizzle-orm';
import { bulletins } from '../../../db/schema';
import { normalizeLink, normalizeSortOrder, parseDateInput } from '../../../utils/content-ops';
import { db } from '../../../utils/db';
import { requireAdmin } from '../../../utils/guard';

const EDITABLE = ['title', 'content', 'imageUrl', 'linkText', 'position', 'level'] as const;
const POSITIONS = ['home', 'chat', 'global'];
const LEVELS = ['info', 'success', 'warning', 'danger'];

/** 宣传栏更新 / 删除 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const id = getRouterParam(event, 'id')!;

    const [existing] = await db.select().from(bulletins).where(eq(bulletins.id, id));
    if (!existing) throw createError({ statusCode: 404, statusMessage: '宣传栏内容不存在' });

    if (getMethod(event) === 'DELETE') {
        await db.delete(bulletins).where(eq(bulletins.id, id));
        return { ok: true };
    }

    const body = (await readBody(event)) ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of EDITABLE) {
        if (body[key] !== undefined) {
            const value = String(body[key] ?? '');
            if (key === 'position' && !POSITIONS.includes(value)) continue;
            if (key === 'level' && !LEVELS.includes(value)) continue;
            patch[key] = value;
        }
    }
    if (patch.title !== undefined && !String(patch.title).trim()) {
        throw createError({ statusCode: 400, statusMessage: '标题不能为空' });
    }
    if (body.linkUrl !== undefined) patch.linkUrl = normalizeLink(body.linkUrl);
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.sortOrder !== undefined) patch.sortOrder = normalizeSortOrder(body.sortOrder);
    if (body.startsAt !== undefined) patch.startsAt = parseDateInput(body.startsAt);
    if (body.endsAt !== undefined) patch.endsAt = parseDateInput(body.endsAt);

    // "没传"和"传了空值清空"必须区分：parseDateInput('') 得到 null，?? 会把它当缺省，
    // 于是管理员清掉开始时间后，时间窗校验仍拿旧值比较，正常的编辑被误判成 400。
    const startsAt = body.startsAt === undefined ? existing.startsAt : (patch.startsAt as Date | null);
    const endsAt = body.endsAt === undefined ? existing.endsAt : (patch.endsAt as Date | null);
    if (startsAt && endsAt && startsAt > endsAt) {
        throw createError({ statusCode: 400, statusMessage: '结束时间不能早于开始时间' });
    }

    await db.update(bulletins).set(patch).where(eq(bulletins.id, id));
    const [row] = await db.select().from(bulletins).where(eq(bulletins.id, id));
    return row;
});
