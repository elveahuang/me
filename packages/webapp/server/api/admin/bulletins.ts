import { asc, desc, eq } from 'drizzle-orm';
import { bulletins } from '../../db/schema';
import { db } from '../../utils/db';
import { requireAdmin } from '../../utils/guard';

/**
 * 宣传栏管理（管理端）。
 * 排序规则与用户端一致：sortOrder 升序，其次创建时间倒序。
 * linkUrl 只允许 http/https 或站内相对路径，避免写入 javascript: 之类协议。
 */
const EDITABLE = ['title', 'content', 'imageUrl', 'linkText', 'position', 'level'] as const;
const POSITIONS = ['home', 'chat', 'global'];
const LEVELS = ['info', 'success', 'warning', 'danger'];

function normalizeLink(raw: unknown): string {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    if (value.startsWith('/')) return value;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw createError({ statusCode: 400, statusMessage: '跳转链接必须是 http/https 地址或以 / 开头的站内路径' });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw createError({ statusCode: 400, statusMessage: '跳转链接仅允许 http/https 协议' });
    }
    return value;
}

function parseDate(raw: unknown): Date | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const date = new Date(String(raw));
    if (Number.isNaN(date.getTime())) {
        throw createError({ statusCode: 400, statusMessage: '时间格式不正确' });
    }
    return date;
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);

    if (getMethod(event) === 'POST') {
        const body = (await readBody(event)) ?? {};
        const title = String(body.title ?? '').trim();
        if (!title) throw createError({ statusCode: 400, statusMessage: '标题必填' });

        const patch: Record<string, unknown> = { title };
        for (const key of EDITABLE) {
            if (key === 'title') continue;
            if (body[key] !== undefined) patch[key] = String(body[key] ?? '');
        }
        patch.linkUrl = normalizeLink(body.linkUrl);
        if (!POSITIONS.includes(String(patch.position))) patch.position = 'home';
        if (!LEVELS.includes(String(patch.level))) patch.level = 'info';
        const startsAt = parseDate(body.startsAt);
        const endsAt = parseDate(body.endsAt);
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
            enabled: body.enabled === undefined ? true : Boolean(body.enabled),
            sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
            startsAt,
            endsAt,
        });
        const [row] = await db.select().from(bulletins).where(eq(bulletins.id, id));
        return row;
    }

    const rows = await db.select().from(bulletins).orderBy(asc(bulletins.sortOrder), desc(bulletins.createdAt));
    return { bulletins: rows };
});
