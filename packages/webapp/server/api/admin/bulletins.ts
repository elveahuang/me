import { asc, desc, eq } from 'drizzle-orm';
import { bulletins } from '../../db/schema';
import { normalizeAdminBoolean } from '../../utils/admin-boolean';
import { assertBulletinField, normalizeLink, normalizeSortOrder, parseDateInput } from '../../utils/content-ops';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';
import { requireMethod } from '../../utils/method';

/**
 * 宣传栏管理（管理端）。
 * 排序规则与用户端一致：sortOrder 升序，其次创建时间倒序。
 * linkUrl 只允许 http/https 或站内相对路径，避免写入 javascript: 之类协议。
 */
const EDITABLE = ['title', 'content', 'imageUrl', 'linkText', 'position', 'level'] as const;
const POSITIONS = ['home', 'chat', 'global'];
const LEVELS = ['info', 'success', 'warning', 'danger'];

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    // 其余方法（PUT/PATCH/DELETE）原本落进下面的读取分支：请求拿到 200 + 列表，看起来像写成功了
    const method = requireMethod(event, ['GET', 'POST']);

    if (method === 'POST') {
        const body = (await readBody(event)) ?? {};
        const title = String(body.title ?? '').trim();
        if (!title) throw createError({ statusCode: 400, statusMessage: '标题必填' });

        const patch: Record<string, unknown> = { title: assertBulletinField('title', title) };
        for (const key of EDITABLE) {
            if (key === 'title') continue;
            if (body[key] !== undefined) patch[key] = assertBulletinField(key, String(body[key] ?? ''));
        }
        patch.linkUrl = normalizeLink(body.linkUrl);
        if (!POSITIONS.includes(String(patch.position))) patch.position = 'home';
        if (!LEVELS.includes(String(patch.level))) patch.level = 'info';
        const startsAt = parseDateInput(body.startsAt);
        const endsAt = parseDateInput(body.endsAt);
        if (startsAt && endsAt && startsAt > endsAt) {
            throw createError({ statusCode: 400, statusMessage: '结束时间不能早于开始时间' });
        }

        const id = crypto.randomUUID();
        await db.insert(bulletins).values({
            id,
            title,
            content: String(patch.content ?? ''),
            imageUrl: String(patch.imageUrl ?? ''),
            linkUrl: String(patch.linkUrl ?? ''),
            linkText: String(patch.linkText ?? ''),
            position: String(patch.position),
            level: String(patch.level),
            enabled: normalizeAdminBoolean(body.enabled, 'enabled', true),
            sortOrder: normalizeSortOrder(body.sortOrder),
            startsAt,
            endsAt,
        });
        const [row] = await db.select().from(bulletins).where(eq(bulletins.id, id));
        return row;
    }

    const rows = await db.select().from(bulletins).orderBy(asc(bulletins.sortOrder), desc(bulletins.createdAt));
    return { bulletins: rows };
});
